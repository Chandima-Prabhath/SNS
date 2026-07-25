'use client'

/**
 * WebRTC voice + video call manager.
 *
 * Audio: browser AEC + AGC + RNNoise neural noise suppression via AudioWorklet.
 * Video: 720p@24fps capped to 1Mbps, camera toggle + switch.
 * Perfect negotiation for glare-free offer/answer.
 * Single peer connection per peer (deduplicated).
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
  // Server-driven call ended (when the other person leaves)
  socket.on('call:ended', (payload: { callId: string; reason: string }) => {
    console.log('[webrtc] call ended by server:', payload.reason)
    window.dispatchEvent(new CustomEvent('sns:call-ended', { detail: payload }))
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
          this.capSenderBitrate(sender, 32_000)
        }
        if (track.kind === 'video') {
          peer.videoSender = sender
          this.capSenderBitrate(sender, 1_000_000)
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

  private async capSenderBitrate(sender: RTCRtpSender, maxBitrate: number) {
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      params.encodings[0].maxBitrate = maxBitrate
      await sender.setParameters(params)
    } catch {}
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
      // Get audio + video in a SINGLE getUserMedia call — this avoids the
      // NotAllowedError that happens when you call getUserMedia twice
      // (once for audio, once for video) on mobile browsers.
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          autoGainControl: true,
          channelCount: 1,
          // Disable browser noiseSuppression if RNNoise is enabled
          noiseSuppression: !this.enableRnnoise,
        } as MediaTrackConstraints,
        video: this.enableVideo
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 24, max: 30 },
              facingMode: 'user',
            }
          : false,
      }

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

      // Apply RNNoise if enabled (audio-only processing)
      if (this.enableRnnoise) {
        await this.applyRnnoise()
      }

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
   * Uses the simple-rnnoise-wasm package's RNNoiseNode which handles
   * WASM compilation and worklet registration.
   */
  private async applyRnnoise() {
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('[webrtc] AudioContext not available, skipping RNNoise')
        return
      }

      this.audioContext = new AudioContextClass({ sampleRate: 48000 })

      // Load the RNNoise WASM module
      const wasmResponse = await fetch('/rnnoise.wasm')
      const wasmBuffer = await wasmResponse.arrayBuffer()
      const wasmModule = await WebAssembly.compile(wasmBuffer)

      // Load the worklet
      await this.audioContext.audioWorklet.addModule('/rnnoise.worklet.js')
      console.log('[webrtc] RNNoise worklet loaded')

      // Create the processing graph
      const source = this.audioContext.createMediaStreamSource(
        new MediaStream([this.localStream!.getAudioTracks()[0]])
      )
      this.rnnoiseNode = new (window as any).AudioWorkletNode(this.audioContext, 'rnnoise', {
        channelCountMode: 'explicit',
        channelCount: 1,
        channelInterpretation: 'speakers',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { module: wasmModule },
      })
      const destination = this.audioContext.createMediaStreamDestination()

      source.connect(this.rnnoiseNode)
      this.rnnoiseNode.connect(destination)

      // Replace the audio track with the processed one
      const processedTrack = destination.stream.getAudioTracks()[0]
      const originalTrack = this.localStream!.getAudioTracks()[0]
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

  setVideoEnabled(enabled: boolean) {
    this.videoEnabled = enabled
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => (t.enabled = enabled))
    }
    this.callbacks.onVideoToggle?.(enabled)
  }

  isVideoEnabled() { return this.videoEnabled }

  async switchCamera(): Promise<boolean> {
    try {
      const videoTrack = this.localStream?.getVideoTracks()[0]
      if (!videoTrack) return false

      const settings = videoTrack.getSettings()
      const currentFacing = settings.facingMode || 'user'
      const newFacing = currentFacing === 'user' ? 'environment' : 'user'

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

      for (const peer of this.peers.values()) {
        if (peer.videoSender) {
          await peer.videoSender.replaceTrack(newTrack)
        }
      }

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
