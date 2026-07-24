'use client'

/**
 * WebRTC voice call manager — production-grade mesh with perfect negotiation.
 *
 * Key fixes in this version:
 *   1. Single peer connection per peerId (deduplicated). Both sides create a PC,
 *      but only ONE side initiates (deterministic: lower socketId = initiator).
 *      This eliminates the "Unknown ufrag" errors caused by dual PC creation.
 *   2. ICE restart only on 'failed' (not 'disconnected'). Disconnected is transient
 *      and self-heals; restarting on it causes the connected→disconnected→checking loop.
 *   3. Stale ufrag candidates are silently dropped (benign during ICE restarts).
 *   4. Autoplay unlock: audio elements are primed on user gesture (the Accept button).
 *   5. Remote audio attached to a persistent DOM <audio> element (not detached).
 */
import type { Socket } from 'socket.io-client'

export interface VoiceCallCallbacks {
  onLocalStream: (stream: MediaStream) => void
  onRemoteStream: (peerId: string, stream: MediaStream, meta: { userId: string; username: string }) => void
  onPeerLeft: (peerId: string) => void
  onStateChange: (state: 'connecting' | 'connected' | 'failed' | 'disconnected') => void
  onMuteChange?: (muted: boolean) => void
  onAudioLevel?: (peerId: string, level: number) => void
  onConnectionType?: (peerId: string, type: 'p2p' | 'turn' | 'unknown') => void
}

interface PeerEntry {
  pc: RTCPeerConnection
  userId: string
  username: string
  makingOffer: boolean
  ignoreOffer: boolean
  isInitiator: boolean // deterministic: lower socketId initiates
  isPolite: boolean // higher socketId is polite (yields in glare)
  audioSender?: RTCRtpSender
  audioLevelChecker?: number
  remoteStream: MediaStream
  audioEl?: HTMLAudioElement
  lastStatsType?: 'p2p' | 'turn' | 'unknown'
  failedTimer?: number
}

// Global listener for incoming calls — registered ONCE when the socket connects
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

export class VoiceCallManager {
  private socket: Socket
  private callId: string
  private callbacks: VoiceCallCallbacks
  private localStream: MediaStream | null = null
  private peers: Map<string, PeerEntry> = new Map()
  private iceServers: RTCIceServer[]
  private userMuted = false
  private silenceDetectorActive = false
  private silenceMuted = false
  private mySocketId: string | null = null
  // Pending audio elements that need a user gesture to play (autoplay unlock)
  private pendingAudioPlays: HTMLAudioElement[] = []

  constructor(params: {
    socket: Socket
    callId: string
    iceServers: RTCIceServer[]
    callbacks: VoiceCallCallbacks
  }) {
    this.socket = params.socket
    this.callId = params.callId
    this.iceServers = params.iceServers
    this.callbacks = params.callbacks
    this.setupSignaling()
  }

  private setupSignaling() {
    // Someone ELSE joined — they will initiate the offer to us (if they're the
    // initiator by socketId comparison). We pre-create the PC as non-initiator.
    this.socket.on('call:peer-joined', async (payload: { peerId: string; userId: string; username: string }) => {
      await this.ensurePeer(payload.peerId, payload.userId, payload.username)
    })

    // We just joined — the server tells us who's already here.
    this.socket.on('call:peers', async (payload: { peers: Array<{ peerId: string; userId: string; username: string }> }) => {
      this.mySocketId = this.socket.id
      for (const peer of payload.peers) {
        await this.ensurePeer(peer.peerId, peer.userId, peer.username)
      }
    })

    // Perfect negotiation: handle incoming offer
    this.socket.on('call:offer', async (payload: { from: string; sdp: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) {
        console.warn('[webrtc] offer from unknown peer', payload.from)
        return
      }
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
        // Silently drop candidates that don't match the current remote description's ufrag
        // (benign during ICE restarts or candidate races)
        const candidate = new RTCIceCandidate(payload.candidate)
        await peer.pc.addIceCandidate(candidate)
      } catch (e: any) {
        // "Unknown ufrag" is expected when candidates from an old ICE generation arrive
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

  /**
   * Ensure exactly ONE peer connection exists per peerId.
   * Both sides call this — only the initiator (lower socketId) sends the initial offer.
   */
  private async ensurePeer(peerId: string, userId: string, username: string) {
    if (this.peers.has(peerId)) return

    const myId = this.socket.id || this.mySocketId || ''
    // Deterministic roles: lower socketId = initiator (sends offer), higher = polite (yields)
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

    // CRITICAL: Add local tracks BEFORE creating any offer
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream)
        if (track.kind === 'audio') {
          peer.audioSender = sender
        }
      }
    }

    // Remote track handler
    pc.ontrack = (event) => {
      console.log('[webrtc] ontrack fired, kind:', event.track.kind)
      // Add the incoming track to our remote stream
      peer.remoteStream.addTrack(event.track)

      // Create or reuse a DOM-attached audio element for this peer.
      // Browsers block autoplay for detached elements and for elements that
      // haven't been "unlocked" by a user gesture.
      if (!peer.audioEl) {
        const el = document.createElement('audio')
        el.autoplay = true
        el.setAttribute('playsinline', '')
        el.style.display = 'none'
        document.body.appendChild(el)
        peer.audioEl = el
      }
      peer.audioEl.srcObject = peer.remoteStream
      // Try to play — if blocked by autoplay, queue for unlock on user gesture
      peer.audioEl.play().catch(() => {
        console.log('[webrtc] autoplay blocked for peer, queuing for unlock')
        this.pendingAudioPlays.push(peer.audioEl!)
      })

      this.callbacks.onRemoteStream(peerId, peer.remoteStream, { userId, username })
      this.startRemoteAudioMonitoring(peerId, peer.remoteStream)
    }

    // Perfect negotiation: onnegotiationneeded fires after addTrack.
    // Only the initiator sends the initial offer — the non-initiator waits.
    pc.onnegotiationneeded = async () => {
      if (!peer.isInitiator) return // non-initiator waits for the offer
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
        // Clear any pending failed timer
        if (peer.failedTimer) {
          clearTimeout(peer.failedTimer)
          peer.failedTimer = undefined
        }
        setTimeout(() => this.checkConnectionType(peerId), 1500)
      } else if (state === 'failed') {
        // Only restart on 'failed', not 'disconnected'
        // Debounce: wait 2s before restarting to avoid rapid loops
        if (!peer.failedTimer) {
          peer.failedTimer = window.setTimeout(() => {
            console.log(`[webrtc] ICE failed, restarting for ${username}`)
            pc.restartIce()
            peer.failedTimer = undefined
          }, 2000)
        }
        this.callbacks.onStateChange('failed')
      } else if (state === 'disconnected') {
        // Transient — don't restart, just notify. It usually self-heals.
        this.callbacks.onStateChange('disconnected')
      }
    }
  }

  /**
   * Unlock audio playback — call this on a user gesture (e.g., Accept call button).
   * Plays all pending audio elements that were blocked by autoplay policy.
   */
  unlockAudio() {
    for (const el of this.pendingAudioPlays) {
      el.play().catch(() => {})
    }
    this.pendingAudioPlays = []
    // Also prime a silent audio context to fully unlock audio on iOS Safari
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (AudioContextClass) {
        const ctx = new AudioContextClass()
        if (ctx.state === 'suspended') ctx.resume()
        // Create a brief silent buffer to "unlock" the audio pipeline
        const buffer = ctx.createBuffer(1, 1, 22050)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        source.start(0)
      }
    } catch {}
  }

  private async checkConnectionType(peerId: string) {
    const peer = this.peers.get(peerId)
    if (!peer) return
    try {
      const stats = await peer.pc.getStats()
      let foundType: 'p2p' | 'turn' | 'unknown' = 'unknown'
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report as any).state === 'succeeded') {
          const localId = (report as any).localCandidateId
          const local = stats.get(localId)
          if (local && (local as any).candidateType === 'relay') {
            foundType = 'turn'
          } else if (local) {
            foundType = 'p2p'
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
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        } as MediaTrackConstraints,
        video: false,
      })

      const audioTrack = this.localStream.getAudioTracks()[0]
      if (audioTrack) {
        const settings = audioTrack.getSettings()
        console.log('[webrtc] mic settings:', {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          channelCount: settings.channelCount,
        })
      }

      if (!micEnabled) this.setMuted(true)
      this.callbacks.onLocalStream(this.localStream)
      this.callbacks.onStateChange('connecting')
      this.socket.emit('call:join', this.callId)
      this.startSilenceDetection(this.localStream)
    } catch (e: any) {
      console.error('[webrtc] getUserMedia error', e)
      throw e
    }
  }

  private startSilenceDetection(stream: MediaStream) {
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) return
      const ctx = new AudioContextClass()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)
      let silentFrames = 0
      const SILENCE_THRESHOLD = 8
      const SILENCE_FRAMES_NEEDED = 30

      this.silenceDetectorActive = true
      const check = () => {
        if (!this.silenceDetectorActive) return
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length
        if (avg < SILENCE_THRESHOLD) {
          silentFrames++
          if (silentFrames >= SILENCE_FRAMES_NEEDED && !this.silenceMuted) {
            this.silenceMuted = true
            this.applyMuteState()
          }
        } else {
          if (this.silenceMuted) {
            this.silenceMuted = false
            this.applyMuteState()
          }
          silentFrames = 0
        }
        requestAnimationFrame(check)
      }
      check()
    } catch (e) {
      console.warn('[webrtc] silence detection unavailable:', e)
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
    const shouldMute = this.userMuted || this.silenceMuted
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
    }
  }

  async leave(): Promise<void> {
    this.silenceDetectorActive = false
    for (const peerId of Array.from(this.peers.keys())) {
      this.removePeer(peerId)
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
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
