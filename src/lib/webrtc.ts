'use client'

/**
 * WebRTC voice call manager — production-grade mesh with perfect negotiation.
 *
 * Key fixes in this version:
 *   1. Single peer connection per peerId (deduplicated).
 *   2. ICE restart only on 'failed' (not 'disconnected').
 *   3. Stale ufrag candidates silently dropped.
 *   4. Autoplay unlock: a global "audio unlocked" flag. When ontrack fires,
 *      if audio is unlocked, we play immediately. If not, we queue and play
 *      on the next user gesture. The flag persists for the page lifetime.
 *   5. Silence detector is DISABLED by default — it was causing the mute
 *      button to get stuck on mobile (mobile mics pick up ambient noise,
 *      triggering false "silence" and auto-muting the user against their will).
 *   6. Reduced ICE servers to avoid the "5+ servers slows down discovery" warning.
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
  isInitiator: boolean
  isPolite: boolean
  audioSender?: RTCRtpSender
  audioLevelChecker?: number
  remoteStream: MediaStream
  audioEl?: HTMLAudioElement
  lastStatsType?: 'p2p' | 'turn' | 'unknown'
  failedTimer?: number
}

// Global listener for incoming calls
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

/**
 * Global audio unlock state.
 *
 * Browsers block audio.play() until a user gesture occurs. Once unlocked,
 * audio can play freely for the lifetime of the page. We track this globally
 * so that even if the VoiceCallManager is recreated, the unlock state persists.
 *
 * When ontrack fires and creates a new <audio> element, we check this flag:
 *   - If unlocked: play immediately
 *   - If not unlocked: queue the element; it'll be played when unlockAudio() is called
 */
let audioUnlocked = false
const pendingAudioElements: HTMLAudioElement[] = []

export function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  console.log('[webrtc] unlocking audio, playing', pendingAudioElements.length, 'pending elements')

  // Play all pending audio elements
  for (const el of pendingAudioElements) {
    el.play().catch((e) => console.warn('[webrtc] pending audio play failed:', e.message))
  }
  pendingAudioElements.length = 0

  // Also prime a silent audio context to fully unlock iOS Safari
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
  private peers: Map<string, PeerEntry> = new Map()
  private iceServers: RTCIceServer[]
  private userMuted = false
  // Silence detector DISABLED — it was causing the mute button to get stuck
  // on mobile (mobile mics pick up ambient noise, triggering false silence
  // detection and auto-muting the user against their will).
  // We keep the field for compatibility but never set it to true.
  private silenceMuted = false

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

    // Add local tracks BEFORE creating any offer
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream)
        if (track.kind === 'audio') {
          peer.audioSender = sender
        }
      }
    }

    // Remote track handler — this is where audio comes in
    pc.ontrack = (event) => {
      console.log('[webrtc] ontrack fired, kind:', event.track.kind, 'audioUnlocked:', audioUnlocked)

      // Add the incoming track to our remote stream
      peer.remoteStream.addTrack(event.track)

      // Create or reuse a DOM-attached audio element
      if (!peer.audioEl) {
        const el = document.createElement('audio')
        el.autoplay = true
        el.setAttribute('playsinline', '')
        el.style.display = 'none'
        document.body.appendChild(el)
        peer.audioEl = el
        console.log('[webrtc] created audio element for peer', peerId)
      }

      // Set the stream as the source
      peer.audioEl.srcObject = peer.remoteStream

      // Try to play. If audio is already unlocked (user gestured earlier),
      // this succeeds. If not, queue it for later unlock.
      const playPromise = peer.audioEl.play()
      if (playPromise) {
        playPromise
          .then(() => console.log('[webrtc] audio playing for peer', peerId))
          .catch((e) => {
            console.warn('[webrtc] audio play blocked for peer, queuing:', e.message)
            if (!pendingAudioElements.includes(peer.audioEl!)) {
              pendingAudioElements.push(peer.audioEl!)
            }
          })
      }

      this.callbacks.onRemoteStream(peerId, peer.remoteStream, { userId, username })
      this.startRemoteAudioMonitoring(peerId, peer.remoteStream)
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
        // Check connection type after ICE settles
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

  private async checkConnectionType(peerId: string) {
    const peer = this.peers.get(peerId)
    if (!peer) return
    try {
      const stats = await peer.pc.getStats()
      let foundType: 'p2p' | 'turn' | 'unknown' = 'unknown'

      stats.forEach((report) => {
        // Look for the active candidate pair (the one currently being used)
        if (report.type === 'candidate-pair') {
          const cp = report as any
          // Only consider the nominated/selected pair, not all pairs
          if (cp.nominated || cp.state === 'succeeded') {
            const localCandidate = stats.get(cp.localCandidateId) as any
            const remoteCandidate = stats.get(cp.remoteCandidateId) as any
            if (localCandidate) {
              // 'relay' = TURN, 'host'/'srflx'/'prflx' = P2P
              if (localCandidate.candidateType === 'relay') {
                foundType = 'turn'
              } else {
                foundType = 'p2p'
              }
              console.log(`[webrtc] connection type: ${foundType} (local: ${localCandidate.candidateType}, remote: ${remoteCandidate?.candidateType})`)
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
    } catch (e: any) {
      console.error('[webrtc] getUserMedia error', e)
      throw e
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
    // Only user mute matters now (silence detector disabled)
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
   * Unlock audio playback — called on user gestures.
   * Delegates to the global unlockAudio function.
   */
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
      // Remove from pending list if present
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
    this.socket.emit('call:leave', this.callId)
    this.socket.removeAllListeners('call:peer-joined')
    this.socket.removeAllListeners('call:peers')
    this.socket.removeAllListeners('call:offer')
    this.socket.removeAllListeners('call:answer')
    this.socket.removeAllListeners('call:ice-candidate')
    this.socket.removeAllListeners('call:peer-left')
  }
}
