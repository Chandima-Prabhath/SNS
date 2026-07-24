'use client'

/**
 * WebRTC voice call manager — perfect negotiation pattern.
 *
 * One-way audio fix: the joiner adds tracks THEN creates the offer (so the offer
 * includes the audio m-line). The existing peer receives the offer, sets remote
 * description, creates answer that ALSO includes audio. Both sides have sendrecv.
 *
 * Audio enhancements:
 *   - echoCancellation, noiseSuppression, autoGainControl (browser DSP)
 *   - Silence detection (auto-mute when not speaking)
 *   - Active-speaker audio level monitoring
 *
 * Ringing: the call:incoming listener is registered GLOBALLY (in the module scope)
 * so it works even when the user is not in a call. This lets the IncomingCallOverlay
 * receive rings regardless of call state.
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
  isPolite: boolean
  audioSender?: RTCRtpSender
  audioLevelChecker?: number
  remoteStream: MediaStream
  lastStatsType?: 'p2p' | 'turn' | 'unknown'
}

// Global listener for incoming calls — registered ONCE when the socket connects,
// so rings arrive even if the user isn't in a call. The IncomingCallOverlay
// listens for the 'sns:incoming-call' window event.
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
    // Someone ELSE joined the call — they will initiate the offer to us.
    // We pre-create the peer connection (non-initiator) so we're ready to receive
    // their offer and answer it.
    this.socket.on('call:peer-joined', async (payload: { peerId: string; userId: string; username: string }) => {
      await this.createPeerConnection(payload.peerId, payload.userId, payload.username, false)
    })

    // We just joined — the server tells us who's already here. We initiate offers
    // to ALL of them (we're the newcomer).
    this.socket.on('call:peers', async (payload: { peers: Array<{ peerId: string; userId: string; username: string }> }) => {
      this.mySocketId = this.socket.id
      for (const peer of payload.peers) {
        // createPeerConnection adds local tracks, which fires onnegotiationneeded,
        // which creates and sends the offer. No need to call negotiate() separately.
        await this.createPeerConnection(peer.peerId, peer.userId, peer.username, true)
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

      if (peer.ignoreOffer) {
        return
      }

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
      } catch (e) {
        if (!peer.ignoreOffer) {
          console.warn('[webrtc] addIceCandidate error:', (e as Error).message)
        }
      }
    })

    this.socket.on('call:peer-left', (payload: { peerId: string; userId: string }) => {
      this.removePeer(payload.peerId)
      this.callbacks.onPeerLeft(payload.peerId)
    })
  }

  private async createPeerConnection(peerId: string, userId: string, username: string, initiator: boolean) {
    if (this.peers.has(peerId)) return

    const myId = this.socket.id || this.mySocketId || ''
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
      isPolite,
      remoteStream: new MediaStream(),
    }
    this.peers.set(peerId, peer)

    // CRITICAL: Add local tracks BEFORE creating any offer. This ensures the
    // offer SDP includes the audio m-line (sendrecv). If we add tracks after
    // creating the offer, the m-line would be recvonly and we'd get one-way audio.
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream)
        if (track.kind === 'audio') {
          peer.audioSender = sender
        }
      }
    } else {
      console.warn('[webrtc] no local stream when creating peer connection — audio will be recvonly!')
    }

    // Remote track handler — fires when we receive the peer's audio
    pc.ontrack = (event) => {
      console.log('[webrtc] ontrack fired, kind:', event.track.kind, 'direction:', event.track.readyState)
      // Add the incoming track to our remote stream
      peer.remoteStream.addTrack(event.track)
      this.callbacks.onRemoteStream(peerId, peer.remoteStream, { userId, username })
      this.startRemoteAudioMonitoring(peerId, peer.remoteStream)
    }

    // Perfect negotiation: onnegotiationneeded fires after addTrack.
    // The initiator (joiner) lets this create the offer. The non-initiator
    // also has this fire (because they added tracks), but since they're waiting
    // for an offer, the resulting offer would collide — perfect negotiation
    // handles that. To be safe, only the initiator sends the initial offer.
    pc.onnegotiationneeded = async () => {
      if (!initiator && peer.pc.connectionState === 'new') {
        // Non-initiator: don't send an offer yet, wait for the joiner's offer.
        // (onnegotiationneeded fires on both sides after addTrack; we only want
        // the joiner to initiate.)
        return
      }
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

    // ICE candidates → trickle to the peer
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
        setTimeout(() => this.checkConnectionType(peerId), 1500)
      } else if (state === 'failed') {
        this.callbacks.onStateChange('failed')
        pc.restartIce()
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
    } catch (e) {
      // stats API not available
    }
  }

  async start(micEnabled: boolean = true): Promise<void> {
    try {
      // Request mic with browser DSP — these constraints force the browser to
      // apply echo cancellation, noise suppression, and auto gain control.
      // If the browser doesn't support a constraint, it's silently ignored.
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        } as MediaTrackConstraints,
        video: false,
      })

      // Log the actual settings we got (for debugging)
      const audioTrack = this.localStream.getAudioTracks()[0]
      if (audioTrack) {
        const settings = audioTrack.getSettings()
        console.log('[webrtc] mic settings:', {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
          channelCount: settings.channelCount,
          sampleRate: settings.sampleRate,
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
        if (!this.peers.has(peerId)) {
          ctx.close()
          return
        }
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length / 255
        this.callbacks.onAudioLevel?.(peerId, avg)
        peer.audioLevelChecker = requestAnimationFrame(check) as unknown as number
      }
      check()
    } catch (e) {
      // best-effort
    }
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

  isMuted() {
    return this.userMuted
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId)
    if (peer) {
      peer.pc.close()
      if (peer.audioLevelChecker) cancelAnimationFrame(peer.audioLevelChecker)
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
