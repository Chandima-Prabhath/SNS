'use client'

/**
 * WebRTC voice + video call manager.
 *
 * Audio enhancements:
 *   - Browser AEC (echoCancellation) + AGC (autoGainControl) — always on
 *   - RNNoise neural noise suppression via AudioWorklet — replaces browser's
 *     noiseSuppression for better quality (RNN-based, trained on real noise)
 *   - Falls back to browser noiseSuppression if RNNoise fails to load
 *
 * Video support:
 *   - 1:1: 720p @ 24fps, capped to 1 Mbps
 *   - Group (≤4): 480p @ 15fps, capped to 500 kbps
 *   - Camera toggle: track.enabled = false (no renegotiation)
 *   - Camera switch: sender.replaceTrack() (no renegotiation)
 *
 * Perfect negotiation pattern for glare-free offer/answer.
 */
import type { Socket } from 'socket.io-client'

export interface VoiceCallCallbacks {
  onLocalStream: (stream: MediaStream) => void
  onRemoteStream: (peerId: string, stream: MediaStream, meta: { userId: string; username: string }) => void
  onPeerLeft: (peerId: string) => void
  onStateChange: (state: 'connecting' | 'connected' | 'failed' | 'disconnected') => void
  onMuteChange?: (muted: boolean) => void
  onVideoToggle?: (enabled: boolean) => void
  onAudioLevel?: (peerId: string, level: number) => void
  onConnectionType?: (peerId: string, type: 'p2p' | 'turn' | 'unknown') => void
}

interface PeerEntry {
  pc: RTCPeerConnection
  userId: string
  username: string
  makingOffer: boolean
  ignoreOffer: boolean
  isInitiator: boolean
  isPolite: boolean
  audioSender?: RTCRtpSender
  videoSender?: RTCRtpSender
  audioLevelChecker?: number
  remoteStream: MediaStream
  audioEl?: HTMLAudioElement
  lastStatsType?: 'p2p' | 'turn' | 'unknown'
  failedTimer?: number
}

let globalIncomingCallListenerRegistered = false

export function registerGlobalCallListeners(socket: Socket) {
  if (globalIncomingCallListenerRegistered) return
  globalIncomingCallListenerRegistered = true

  socket.on('call:incoming', (payload: any) => {
    console.log('[webrtc] incoming call from', payload.from?.displayName)
    window.dispatchEvent(new CustomEvent('sns:incoming-call', { detail: payload }))
  })
  socket.on('call:cancel', (payload: any) => {
    window.dispatchEvent(new CustomEvent('sns:call-cancelled', { detail: payload }))
  })
  socket.on('call:reject', (payload: any) => {
    window.dispatchEvent(new CustomEvent('sns:call-rejected', { detail: payload }))
  })
  socket.on('call:accept', (payload: any) => {
    window.dispatchEvent(new CustomEvent('sns:call-accepted', { detail: payload }))
  })
}

let audioUnlocked = false
const pendingAudioElements: HTMLAudioElement[] = []

export function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  console.log('[webrtc] unlocking audio, playing', pendingAudioElements.length, 'pending elements')
  for (const el of pendingAudioElements) {
    el.play().catch((e) => console.warn('[webrtc] pending audio play failed:', e.message))
  }
  pendingAudioElements.length = 0
  try {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
    if (AudioContextClass) {
      const ctx = new AudioContextClass()
      if (ctx.state === 'suspended') ctx.resume()
      const buffer = ctx.createBuffer(1, 1, 22050)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start(0)
    }
  } catch {}
}

export class VoiceCallManager {
  private socket: Socket
  private callId: string
  private callbacks: VoiceCallCallbacks
  private localStream: MediaStream | null = null
  private videoStream: MediaStream | null = null // separate video stream for camera switching
  private audioContext: AudioContext | null = null
  private rnnoiseNode: any = null
  private peers: Map<string, PeerEntry> = new Map()
  private iceServers: RTCIceServer[]
  private userMuted = false
  private videoEnabled = true
  private enableVideo: boolean
  private enableRnnoise: boolean

  constructor(params: {
    socket: Socket
    callId: string
    iceServers: RTCIceServer[]
    callbacks: VoiceCallCallbacks
    enableVideo?: boolean
    enableRnnoise?: boolean
  }) {
    this.socket = params.socket
    this.callId = params.callId
    this.iceServers = params.iceServers
    this.callbacks = params.callbacks
    this.enableVideo = params.enableVideo ?? false
    this.enableRnnoise = params.enableRnnoise ?? true
    this.setupSignaling()
  }

  private setupSignaling() {
    this.socket.on('call:peer-joined', async (payload: { peerId: string; userId: string; username: string }) => {
      await this.ensurePeer(payload.peerId, payload.userId, payload.username)
    })

    this.socket.on('call:peers', async (payload: { peers: Array<{ peerId: string; userId: string; username: string }> }) => {
      for (const peer of payload.peers) {
        await this.ensurePeer(peer.peerId, peer.userId, peer.username)
      }
    })

    this.socket.on('call:offer', async (payload: { from: string; sdp: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      const offerCollision = peer.makingOffer || peer.pc.signalingState !== 'stable'
      peer.ignoreOffer = !peer.isPolite && offerCollision
      if (peer.ignoreOffer) return
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        await peer.pc.setLocalDescription()
        this.socket.emit('call:answer', { to: payload.from, sdp: peer.pc.localDescription })
      } catch (e) {
        console.error('[webrtc] error handling offer:', e)
      }
    })

    this.socket.on('call:answer', async (payload: { from: string; sdp: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
      } catch (e) {
        console.warn('[webrtc] setRemoteDescription(answer) failed:', (e as Error).message)
      }
    })

    this.socket.on('call:ice-candidate', async (payload: { from: string; candidate: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
      } catch (e: any) {
        if (!/ufrag/i.test(e.message)) {
          console.warn('[webrtc] addIceCandidate error:', e.message)
        }
      }
    })

    this.socket.on('call:peer-left', (payload: { peerId: string; userId: string }) => {
      this.removePeer(payload.peerId)
      this.callbacks.onPeerLeft(payload.peerId)
    })
  }

  private async ensurePeer(peerId: string, userId: string, username: string) {
    if (this.peers.has(peerId)) return

    const myId = this.socket.id || ''
    const isInitiator = myId < peerId
    const isPolite = myId > peerId

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
    })

    const peer: PeerEntry = {
      pc,
      userId,
      username,
      makingOffer: false,
      ignoreOffer: false,
      isInitiator,
      isPolite,
      remoteStream: new MediaStream(),
    }
    this.peers.set(peerId, peer)

    // Add local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream)
        if (track.kind === 'audio') {
          peer.audioSender = sender
          // Cap audio bitrate
          this.capSenderBitrate(sender, 32_000) // 32 kbps for opus voice
        }
        if (track.kind === 'video') {
          peer.videoSender = sender
          // Cap video bitrate based on call type
          this.capSenderBitrate(sender, this.enableVideo ? 1_000_000 : 500_000)
        }
      }
    }

    pc.ontrack = (event) => {
      console.log('[webrtc] ontrack fired, kind:', event.track.kind)
      peer.remoteStream.addTrack(event.track)

      if (event.track.kind === 'audio') {
        if (!peer.audioEl) {
          const el = document.createElement('audio')
          el.autoplay = true
          el.setAttribute('playsinline', '')
          el.style.display = 'none'
          document.body.appendChild(el)
          peer.audioEl = el
        }
        peer.audioEl.srcObject = peer.remoteStream
        const playPromise = peer.audioEl.play()
        if (playPromise) {
          playPromise
            .then(() => console.log('[webrtc] audio playing for peer', peerId))
            .catch((e) => {
              console.warn('[webrtc] audio play blocked, queuing:', e.message)
              if (!pendingAudioElements.includes(peer.audioEl!)) {
                pendingAudioElements.push(peer.audioEl!)
              }
            })
        }
        this.startRemoteAudioMonitoring(peerId, peer.remoteStream)
      }

      this.callbacks.onRemoteStream(peerId, peer.remoteStream, { userId, username })
    }

    pc.onnegotiationneeded = async () => {
      if (!peer.isInitiator) return
      try {
        peer.makingOffer = true
        await pc.setLocalDescription()
        this.socket.emit('call:offer', { to: peerId, sdp: pc.localDescription })
      } catch (e) {
        console.error('[webrtc] negotiationneeded error:', e)
      } finally {
        peer.makingOffer = false
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('call:ice-candidate', { to: peerId, candidate: event.candidate })
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      console.log(`[webrtc] ICE state (${username}): ${state}`)
      if (state === 'connected' || state === 'completed') {
        this.callbacks.onStateChange('connected')
        if (peer.failedTimer) {
          clearTimeout(peer.failedTimer)
          peer.failedTimer = undefined
        }
        setTimeout(() => this.checkConnectionType(peerId), 2000)
      } else if (state === 'failed') {
        if (!peer.failedTimer) {
          peer.failedTimer = window.setTimeout(() => {
            console.log(`[webrtc] ICE failed, restarting for ${username}`)
            pc.restartIce()
            peer.failedTimer = undefined
          }, 2000)
        }
        this.callbacks.onStateChange('failed')
      } else if (state === 'disconnected') {
        this.callbacks.onStateChange('disconnected')
      }
    }
  }

  /**
   * Cap a sender's bitrate to limit bandwidth usage.
   */
  private async capSenderBitrate(sender: RTCRtpSender, maxBitrate: number) {
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      params.encodings[0].maxBitrate = maxBitrate
      await sender.setParameters(params)
    } catch (e) {
      // Some browsers don't support setParameters — ignore
    }
  }

  private async checkConnectionType(peerId: string) {
    const peer = this.peers.get(peerId)
    if (!peer) return
    try {
      const stats = await peer.pc.getStats()
      let foundType: 'p2p' | 'turn' | 'unknown' = 'unknown'
      stats.forEach((report) => {
        if (report.type === 'candidate-pair') {
          const cp = report as any
          if (cp.nominated || cp.state === 'succeeded') {
            const localCandidate = stats.get(cp.localCandidateId) as any
            if (localCandidate) {
              if (localCandidate.candidateType === 'relay') {
                foundType = 'turn'
              } else {
                foundType = 'p2p'
              }
              console.log(`[webrtc] connection type: ${foundType} (local: ${localCandidate.candidateType})`)
            }
          }
        }
      })
      if (foundType !== peer.lastStatsType) {
        peer.lastStatsType = foundType
        this.callbacks.onConnectionType?.(peerId, foundType)
      }
    } catch {}
  }

  async start(micEnabled: boolean = true): Promise<void> {
    try {
      // Get audio with AEC + AGC, but disable browser noiseSuppression if we're using RNNoise
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        autoGainControl: true,
        channelCount: 1,
      }
      if (this.enableRnnoise) {
        // RNNoise will handle noise suppression — disable browser's to avoid double processing
        audioConstraints.noiseSuppression = false
      } else {
        audioConstraints.noiseSuppression = true
      }

      // Get video if enabled
      const videoConstraints = this.enableVideo
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
            facingMode: 'user',
          }
        : false

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      })

      // Apply RNNoise if enabled
      if (this.enableRnnoise) {
        await this.applyRnnoise()
      }

      // Log mic settings
      const audioTrack = this.localStream.getAudioTracks()[0]
      if (audioTrack) {
        const settings = audioTrack.getSettings()
        console.log('[webrtc] mic settings:', {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          channelCount: settings.channelCount,
          rnnoise: this.enableRnnoise && !!this.rnnoiseNode,
        })
      }

      if (!micEnabled) this.setMuted(true)
      this.callbacks.onLocalStream(this.localStream)
      this.callbacks.onStateChange('connecting')
      this.socket.emit('call:join', this.callId)
    } catch (e: any) {
      console.error('[webrtc] getUserMedia error', e)
      throw e
    }
  }

  /**
   * Apply RNNoise neural noise suppression via AudioWorklet.
   * Creates an audio processing graph: source → rnnoise → destination
   * The destination stream replaces the original audio track.
   */
  private async applyRnnoise() {
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('[webrtc] AudioContext not available, skipping RNNoise')
        return
      }

      this.audioContext = new AudioContextClass({
        sampleRate: 48000, // RNNoise expects 48kHz
      })

      // Load the RNNoise worklet
      await this.audioContext.audioWorklet.addModule('/rnnoise.worklet.js')
      console.log('[webrtc] RNNoise worklet loaded')

      // Create the processing graph
      const source = this.audioContext.createMediaStreamSource(
        new MediaStream([this.localStream!.getAudioTracks()[0]])
      )
      this.rnnoiseNode = new (window as any).AudioWorkletNode(this.audioContext, 'rnnoise', {
        processorOptions: { frameSize: 480 },
      })
      const destination = this.audioContext.createMediaStreamDestination()

      source.connect(this.rnnoiseNode)
      this.rnnoiseNode.connect(destination)

      // Replace the audio track with the processed one
      const processedTrack = destination.stream.getAudioTracks()[0]
      const originalTrack = this.localStream!.getAudioTracks()[0]

      // Remove original audio track, add processed one
      this.localStream!.removeTrack(originalTrack)
      this.localStream!.addTrack(processedTrack)

      console.log('[webrtc] RNNoise applied successfully')
    } catch (e) {
      console.warn('[webrtc] RNNoise failed, falling back to browser noiseSuppression:', e)
      // Fall back: re-acquire with browser noiseSuppression
      try {
        const originalTrack = this.localStream!.getAudioTracks()[0]
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
          video: false,
        })
        this.localStream!.removeTrack(originalTrack)
        originalTrack.stop()
        this.localStream!.addTrack(newStream.getAudioTracks()[0])
      } catch (fallbackErr) {
        console.error('[webrtc] fallback also failed:', fallbackErr)
      }
    }
  }

  private startRemoteAudioMonitoring(peerId: string, stream: MediaStream) {
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) return
      const peer = this.peers.get(peerId)
      if (!peer) return
      const ctx = new AudioContextClass()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const check = () => {
        if (!this.peers.has(peerId)) { ctx.close(); return }
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length / 255
        this.callbacks.onAudioLevel?.(peerId, avg)
        peer.audioLevelChecker = requestAnimationFrame(check) as unknown as number
      }
      check()
    } catch {}
  }

  private applyMuteState() {
    const shouldMute = this.userMuted
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => (t.enabled = !shouldMute))
    }
    this.callbacks.onMuteChange?.(shouldMute)
  }

  setMuted(muted: boolean) {
    this.userMuted = muted
    this.applyMuteState()
  }

  isMuted() { return this.userMuted }

  /**
   * Toggle video on/off (camera mute). Uses track.enabled to avoid renegotiation.
   */
  setVideoEnabled(enabled: boolean) {
    this.videoEnabled = enabled
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => (t.enabled = enabled))
    }
    this.callbacks.onVideoToggle?.(enabled)
  }

  isVideoEnabled() { return this.videoEnabled }

  /**
   * Switch camera (front/back on mobile). Uses sender.replaceTrack to avoid renegotiation.
   */
  async switchCamera(): Promise<boolean> {
    try {
      const videoTrack = this.localStream?.getVideoTracks()[0]
      if (!videoTrack) return false

      // Get the current facing mode
      const settings = videoTrack.getSettings()
      const currentFacing = settings.facingMode || 'user'
      const newFacing = currentFacing === 'user' ? 'environment' : 'user'

      // Get the new camera stream
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: { exact: newFacing },
        },
        audio: false,
      })

      const newTrack = newStream.getVideoTracks()[0]

      // Replace the track in all peer connections
      for (const peer of this.peers.values()) {
        if (peer.videoSender) {
          await peer.videoSender.replaceTrack(newTrack)
        }
      }

      // Update the local stream
      this.localStream!.removeTrack(videoTrack)
      this.localStream!.addTrack(newTrack)
      videoTrack.stop()

      console.log('[webrtc] camera switched to', newFacing)
      return true
    } catch (e) {
      console.error('[webrtc] camera switch failed:', e)
      return false
    }
  }

  unlockAudio() {
    unlockAudio()
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId)
    if (peer) {
      peer.pc.close()
      if (peer.audioLevelChecker) cancelAnimationFrame(peer.audioLevelChecker)
      if (peer.audioEl) {
        peer.audioEl.srcObject = null
        peer.audioEl.remove()
      }
      if (peer.failedTimer) clearTimeout(peer.failedTimer)
      this.peers.delete(peerId)
      const idx = pendingAudioElements.indexOf(peer.audioEl!)
      if (idx >= 0) pendingAudioElements.splice(idx, 1)
    }
  }

  async leave(): Promise<void> {
    for (const peerId of Array.from(this.peers.keys())) {
      this.removePeer(peerId)
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }
    if (this.audioContext) {
      try { await this.audioContext.close() } catch {}
      this.audioContext = null
    }
    this.socket.emit('call:leave', this.callId)
    this.socket.removeAllListeners('call:peer-joined')
    this.socket.removeAllListeners('call:peers')
    this.socket.removeAllListeners('call:offer')
    this.socket.removeAllListeners('call:answer')
    this.socket.removeAllListeners('call:ice-candidate')
    this.socket.removeAllListeners('call:peer-left')
  }
}
