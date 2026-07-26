'use client'

/**
 * Adoo Call Manager — Singleton
 *
 * This is a module-scoped singleton (NOT React state). One instance exists
 * for the entire app lifetime. This avoids the "multiple useVoiceCall instances"
 * bug where each component creates its own manager and they fight over control.
 *
 * Architecture:
 *   - CallManager class: owns the socket, RTCPeerConnections, local streams
 *   - callManager singleton: the one instance, created lazily
 *   - useCall hook: thin React wrapper that reads from the Zustand callStore
 *   - CallController: mounted once at app root, wires manager events to store
 *
 * Mute fix: we toggle sender.track.enabled on the SENDER track (the processed
 * one from AudioWorklet), not the source track. The source track stays enabled
 * so the worklet keeps running. We also gate the worklet output node directly.
 *
 * Call ending: full 6-step cleanup on both sides (stop tracks, close PCs,
 * remove listeners, notify server, detach media, reset state).
 */

import type { Socket } from 'socket.io-client'

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended'

export interface CallParticipant {
  peerId: string
  userId: string
  username: string
  stream?: MediaStream
  muted: boolean
  videoEnabled: boolean
}

export interface CallManagerCallbacks {
  onStatusChange: (status: CallStatus) => void
  onLocalStream: (stream: MediaStream | null) => void
  onParticipantsChange: (participants: CallParticipant[]) => void
  onMuteChange: (muted: boolean) => void
  onVideoToggle: (enabled: boolean) => void
  onConnectionType: (peerId: string, type: 'p2p' | 'turn' | 'unknown') => void
  onAudioLevel: (peerId: string, level: number) => void
  onIncomingCall: (payload: IncomingCallPayload) => void
  onCallEnded: (reason: string) => void
}

export interface IncomingCallPayload {
  callId: string
  from: { userId: string; username: string; displayName: string }
  channelId?: string
  dmGroupId?: string
  video?: boolean
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
  remoteStream: MediaStream
  audioEl?: HTMLAudioElement
  audioLevelChecker?: number
  lastStatsType?: 'p2p' | 'turn' | 'unknown'
  failedTimer?: number
}

// Audio unlock (autoplay policy)
let audioUnlocked = false
const pendingAudioElements: HTMLAudioElement[] = []

export function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  for (const el of pendingAudioElements) {
    el.play().catch(() => {})
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

export class CallManager {
  private socket: Socket | null = null
  private callId: string | null = null
  private callbacks: CallManagerCallbacks | null = null

  // Local media
  private localStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private rnnoiseNode: any = null
  private gainNode: any = null // for muting the worklet output
  private sourceAudioTrack: MediaStreamTrack | null = null // original mic track
  private processedAudioTrack: MediaStreamTrack | null = null // after RNNoise

  // Peers
  private peers: Map<string, PeerEntry> = new Map()
  private iceServers: RTCIceServer[] = []

  // State
  private userMuted = false
  private videoEnabled = true
  private isVideoCall = false
  private enableRnnoise = true
  private status: CallStatus = 'idle'
  private wakeLock: any = null

  // Global listeners registered flag
  private globalListenersRegistered = false

  setSocket(socket: Socket) {
    this.socket = socket
    this.registerGlobalListeners()
  }

  setCallbacks(callbacks: CallManagerCallbacks) {
    this.callbacks = callbacks
  }

  setIceServers(servers: RTCIceServer[]) {
    this.iceServers = servers
  }

  private registerGlobalListeners() {
    if (!this.socket || this.globalListenersRegistered) return
    this.globalListenersRegistered = true

    this.socket.on('call:incoming', (payload: any) => {
      console.log('[call] incoming call from', payload.from?.displayName)
      this.callbacks?.onIncomingCall(payload)
    })

    this.socket.on('call:cancel', (payload: any) => {
      window.dispatchEvent(new CustomEvent('sns:call-cancelled', { detail: payload }))
    })

    this.socket.on('call:reject', (payload: any) => {
      console.log('[call] call rejected by remote')
      // Stop ringback sound immediately
      import('./call-sounds').then(m => m.CallSounds.stop()).catch(() => {})
      // If we're the caller and the call was rejected, end our side
      if (this.callId && this.status !== 'idle') {
        this.endCallCleanup()
        this.callbacks?.onCallEnded('rejected')
      }
      window.dispatchEvent(new CustomEvent('sns:call-rejected', { detail: payload }))
    })

    this.socket.on('call:accept', (payload: any) => {
      console.log('[call] call accepted by remote')
      // Stop ringback sound — the call is connecting now
      import('./call-sounds').then(m => m.CallSounds.stop()).catch(() => {})
      window.dispatchEvent(new CustomEvent('sns:call-accepted', { detail: payload }))
    })

    this.socket.on('call:ended', (payload: { callId: string; reason: string }) => {
      console.log('[call] call ended by server:', payload.reason)
      this.endCallCleanup()
      // Play ended sound
      import('./call-sounds').then(m => m.CallSounds.playEnded()).catch(() => {})
      this.callbacks?.onCallEnded(payload.reason)
    })
  }

  private setStatus(status: CallStatus) {
    this.status = status
    this.callbacks?.onStatusChange(status)
  }

  getStatus() { return this.status }
  getCallId() { return this.callId }
  getLocalStream() { return this.localStream }
  isMuted() { return this.userMuted }
  isVideoEnabled() { return this.videoEnabled }
  isVideoCall() { return this.isVideoCall }

  getParticipants(): CallParticipant[] {
    return Array.from(this.peers.entries()).map(([peerId, p]) => ({
      peerId,
      userId: p.userId,
      username: p.username,
      stream: p.remoteStream,
      muted: false,
      videoEnabled: true,
    }))
  }

  /**
   * Start a call — gets mic (and optionally camera), sets up WebRTC.
   */
  async startCall(params: {
    callId: string
    channelId?: string | null
    dmGroupId?: string | null
    enableVideo?: boolean
  }): Promise<void> {
    if (!this.socket) throw new Error('Socket not connected')
    if (this.iceServers.length === 0) throw new Error('ICE servers not loaded')

    this.callId = params.callId
    this.isVideoCall = params.enableVideo ?? false
    this.setStatus('connecting')

    // Acquire wake lock to prevent screen sleep
    try {
      this.wakeLock = await (navigator as any).wakeLock?.request('screen')
    } catch {}

    // Get audio + video in a SINGLE getUserMedia call
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        autoGainControl: true,
        channelCount: 1,
        noiseSuppression: !this.enableRnnoise,
      } as MediaTrackConstraints,
      video: this.isVideoCall
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }
        : false,
    }

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

    // Store the source audio track (before RNNoise processing)
    this.sourceAudioTrack = this.localStream.getAudioTracks()[0]

    // Apply RNNoise if enabled
    if (this.enableRnnoise) {
      await this.applyRnnoise()
    }

    this.processedAudioTrack = this.localStream.getAudioTracks()[0]

    console.log('[call] local stream ready, video:', this.isVideoCall, 'rnnoise:', !!this.rnnoiseNode)
    this.callbacks?.onLocalStream(this.localStream)

    // CRITICAL: Register signaling listeners BEFORE joining the call room.
    // The server immediately sends 'call:peers' when we join, so we need
    // the listeners in place BEFORE the emit. Otherwise the event arrives
    // with no handler and the call never connects (stuck on 'connecting').
    this.setupCallSignaling()

    // Join the call room
    this.socket.emit('call:join', this.callId)
    console.log('[call] joined call room', this.callId)
  }

  /**
   * Apply RNNoise neural noise suppression.
   * Creates: source → rnnoise worklet → gainNode → destination
   * The gainNode lets us mute without affecting the worklet processing.
   */
  private async applyRnnoise() {
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) return

      this.audioContext = new AudioContextClass({ sampleRate: 48000 })

      // Load WASM
      const wasmResponse = await fetch('/rnnoise.wasm')
      const wasmBuffer = await wasmResponse.arrayBuffer()
      const wasmModule = await WebAssembly.compile(wasmBuffer)

      await this.audioContext.audioWorklet.addModule('/rnnoise.worklet.js')
      console.log('[call] RNNoise worklet loaded')

      const source = this.audioContext.createMediaStreamSource(
        new MediaStream([this.sourceAudioTrack!])
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
      // Gain node for muting — set to 0 to mute, 1 to unmute
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = 1

      const destination = this.audioContext.createMediaStreamDestination()

      source.connect(this.rnnoiseNode)
      this.rnnoiseNode.connect(this.gainNode)
      this.gainNode.connect(destination)

      // Replace the audio track with the processed one
      const processedTrack = destination.stream.getAudioTracks()[0]
      this.localStream!.removeTrack(this.sourceAudioTrack!)
      this.localStream!.addTrack(processedTrack)

      console.log('[call] RNNoise applied successfully')
    } catch (e) {
      console.warn('[call] RNNoise failed, using browser noiseSuppression:', e)
    }
  }

  /**
   * Toggle mute — works correctly even with AudioWorklet.
   * We toggle BOTH the sender track AND the gain node.
   */
  setMuted(muted: boolean) {
    this.userMuted = muted

    // Toggle the processed track's enabled state (for the sender)
    if (this.processedAudioTrack) {
      this.processedAudioTrack.enabled = !muted
    }

    // Also toggle the gain node (handles AudioWorklet interference)
    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : 1
    }

    console.log('[call] mute set to', muted)
    this.callbacks?.onMuteChange(muted)
  }

  toggleMute() {
    this.setMuted(!this.userMuted)
  }

  /**
   * Toggle video on/off.
   */
  setVideoEnabled(enabled: boolean) {
    this.videoEnabled = enabled
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => (t.enabled = enabled))
    }
    console.log('[call] video enabled:', enabled)
    this.callbacks?.onVideoToggle(enabled)
  }

  toggleVideo() {
    this.setVideoEnabled(!this.videoEnabled)
  }

  /**
   * Switch camera (front/back).
   */
  async switchCamera(): Promise<boolean> {
    try {
      const videoTrack = this.localStream?.getVideoTracks()[0]
      if (!videoTrack) return false

      const settings = videoTrack.getSettings()
      const currentFacing = settings.facingMode || 'user'
      const newFacing = currentFacing === 'user' ? 'environment' : 'user'

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: { exact: newFacing } },
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

      console.log('[call] camera switched to', newFacing)
      return true
    } catch (e) {
      console.error('[call] camera switch failed:', e)
      return false
    }
  }

  // Screen sharing state
  private screenStream: MediaStream | null = null
  private isSharingScreen = false
  private originalVideoTrack: MediaStreamTrack | null = null

  /**
   * Start screen sharing — replaces the video track with the screen capture.
   */
  async startScreenShare(): Promise<boolean> {
    try {
      const videoTrack = this.localStream?.getVideoTracks()[0]
      if (!videoTrack) return false

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      })

      const screenTrack = this.screenStream.getVideoTracks()[0]
      this.originalVideoTrack = videoTrack

      // Replace the track in all peer connections
      for (const peer of this.peers.values()) {
        if (peer.videoSender) {
          await peer.videoSender.replaceTrack(screenTrack)
        }
      }

      // Update the local stream
      this.localStream!.removeTrack(videoTrack)
      this.localStream!.addTrack(screenTrack)

      // Listen for the user stopping screen share via browser UI
      screenTrack.onended = () => {
        this.stopScreenShare()
      }

      this.isSharingScreen = true
      this.callbacks?.onVideoToggle(true) // trigger UI update
      console.log('[call] screen share started')
      return true
    } catch (e) {
      console.error('[call] screen share failed:', e)
      return false
    }
  }

  /**
   * Stop screen sharing — restores the original camera track.
   */
  async stopScreenShare(): Promise<void> {
    if (!this.isSharingScreen || !this.originalVideoTrack) return

    const screenTrack = this.screenStream?.getVideoTracks()[0]
    if (screenTrack) {
      screenTrack.stop()
    }

    // Restore the original camera track
    for (const peer of this.peers.values()) {
      if (peer.videoSender) {
        await peer.videoSender.replaceTrack(this.originalVideoTrack)
      }
    }

    // Update the local stream
    const currentTrack = this.localStream?.getVideoTracks()[0]
    if (currentTrack) {
      this.localStream!.removeTrack(currentTrack)
    }
    this.localStream!.addTrack(this.originalVideoTrack)

    this.screenStream = null
    this.isSharingScreen = false
    this.originalVideoTrack = null
    this.callbacks?.onVideoToggle(true) // trigger UI update
    console.log('[call] screen share stopped')
  }

  isScreenSharing() { return this.isSharingScreen }

  /**
   * End the call — full cleanup.
   * Called when the user clicks End OR when the server says the call ended.
   */
  async endCall(): Promise<void> {
    if (!this.callId) return
    console.log('[call] ending call', this.callId)

    // Notify server
    if (this.socket) {
      this.socket.emit('call:leave', this.callId)
    }

    // Server-side cleanup (mark call as ended)
    if (this.callId) {
      try {
        await fetch(`/api/calls/${this.callId}`, { method: 'DELETE' })
      } catch {}
    }

    this.endCallCleanup()
    // Play ended sound
    import('./call-sounds').then(m => m.CallSounds.playEnded()).catch(() => {})
    this.callbacks?.onCallEnded('user_ended')
  }

  /**
   * Full cleanup — stop tracks, close PCs, remove listeners, detach media.
   */
  private endCallCleanup() {
    console.log('[call] running cleanup')

    // Stop any playing call sounds
    import('./call-sounds').then(m => m.CallSounds.stop()).catch(() => {})

    // Stop screen share if active
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
      this.screenStream = null
      this.isSharingScreen = false
      this.originalVideoTrack = null
    }

    // Close all peer connections
    for (const [peerId, peer] of this.peers) {
      try {
        peer.pc.close()
      } catch {}
      if (peer.audioLevelChecker) cancelAnimationFrame(peer.audioLevelChecker)
      if (peer.audioEl) {
        peer.audioEl.srcObject = null
        peer.audioEl.remove()
      }
      if (peer.failedTimer) clearTimeout(peer.failedTimer)
    }
    this.peers.clear()

    // Stop local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }
    if (this.sourceAudioTrack) {
      this.sourceAudioTrack.stop()
      this.sourceAudioTrack = null
    }
    this.processedAudioTrack = null

    // Close audio context
    if (this.audioContext) {
      try { this.audioContext.close() } catch {}
      this.audioContext = null
      this.rnnoiseNode = null
      this.gainNode = null
    }

    // Release wake lock
    if (this.wakeLock) {
      try { this.wakeLock.release() } catch {}
      this.wakeLock = null
    }

    // Remove socket listeners for this call
    if (this.socket) {
      this.socket.removeAllListeners('call:peer-joined')
      this.socket.removeAllListeners('call:peers')
      this.socket.removeAllListeners('call:offer')
      this.socket.removeAllListeners('call:answer')
      this.socket.removeAllListeners('call:ice-candidate')
      this.socket.removeAllListeners('call:peer-left')
    }
    this.signalingSetup = false // allow setupCallSignaling() on next call

    // Reset state
    this.callId = null
    this.userMuted = false
    this.videoEnabled = true
    this.isVideoCall = false
    this.setStatus('idle')

    // Notify participants cleared
    this.callbacks?.onLocalStream(null)
    this.callbacks?.onParticipantsChange([])
  }

  // ─── WebRTC signaling ──────────────────────────────────────────────────

  private signalingSetup = false

  private setupCallSignaling() {
    if (!this.socket || this.signalingSetup) return
    this.signalingSetup = true
    console.log('[call] setting up signaling listeners')

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
        this.socket!.emit('call:answer', { to: payload.from, sdp: peer.pc.localDescription })
      } catch (e) {
        console.error('[call] error handling offer:', e)
      }
    })

    this.socket.on('call:answer', async (payload: { from: string; sdp: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
      } catch (e) {
        console.warn('[call] setRemoteDescription(answer) failed:', (e as Error).message)
      }
    })

    this.socket.on('call:ice-candidate', async (payload: { from: string; candidate: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
      } catch (e: any) {
        if (!/ufrag/i.test(e.message)) {
          console.warn('[call] addIceCandidate error:', e.message)
        }
      }
    })

    this.socket.on('call:peer-left', (payload: { peerId: string; userId: string }) => {
      const peer = this.peers.get(payload.peerId)
      if (peer) {
        peer.pc.close()
        if (peer.audioLevelChecker) cancelAnimationFrame(peer.audioLevelChecker)
        if (peer.audioEl) {
          peer.audioEl.srcObject = null
          peer.audioEl.remove()
        }
        this.peers.delete(payload.peerId)
        this.callbacks?.onParticipantsChange(this.getParticipants())
      }
    })
  }

  private async ensurePeer(peerId: string, userId: string, username: string) {
    if (this.peers.has(peerId)) return

    const myId = this.socket!.id || ''
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
      // Prefer VP8 video codec — Firefox Android doesn't support H.264 reliably.
      // Must be called AFTER tracks are added (transceivers are created by addTrack).
      this.preferVp8(pc)
    }

    pc.ontrack = (event) => {
      console.log('[call] ontrack, kind:', event.track.kind)
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
        peer.audioEl.play().catch((e) => {
          if (!pendingAudioElements.includes(peer.audioEl!)) {
            pendingAudioElements.push(peer.audioEl!)
          }
        })
        this.startRemoteAudioMonitoring(peerId, peer.remoteStream)
      }

      this.callbacks?.onParticipantsChange(this.getParticipants())
    }

    pc.onnegotiationneeded = async () => {
      if (!peer.isInitiator) return
      try {
        peer.makingOffer = true
        await pc.setLocalDescription()
        this.socket!.emit('call:offer', { to: peerId, sdp: pc.localDescription })
      } catch (e) {
        console.error('[call] negotiationneeded error:', e)
      } finally {
        peer.makingOffer = false
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket!.emit('call:ice-candidate', { to: peerId, candidate: event.candidate })
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      console.log(`[call] ICE state (${username}): ${state}`)
      if (state === 'connected' || state === 'completed') {
        if (this.status !== 'connected') {
          this.setStatus('connected')
          // Play connected sound
          import('./call-sounds').then(m => { m.CallSounds.stop(); m.CallSounds.playConnected() }).catch(() => {})
        }
        if (peer.failedTimer) { clearTimeout(peer.failedTimer); peer.failedTimer = undefined }
        setTimeout(() => this.checkConnectionType(peerId), 2000)
      } else if (state === 'failed') {
        if (!peer.failedTimer) {
          peer.failedTimer = window.setTimeout(() => {
            pc.restartIce()
            peer.failedTimer = undefined
          }, 2000)
        }
      }
    }
  }

  /**
   * Prefer VP8 video codec for cross-browser compatibility.
   * Firefox Android doesn't support H.264 reliably — VP8 is the only
   * universally supported WebRTC video codec (RFC 7742).
   */
  private preferVp8(pc: RTCPeerConnection) {
    try {
      const transceivers = pc.getTransceivers()
      for (const t of transceivers) {
        if (t.receiver && 'track' in t.receiver && t.receiver.track?.kind === 'video') {
          const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || []
          const vp8 = codecs.filter((c) => c.mimeType === 'video/VP8')
          const rest = codecs.filter((c) => c.mimeType !== 'video/VP8' && c.mimeType !== 'video/rtx' && c.mimeType !== 'video/red' && c.mimeType !== 'video/ulpfec')
          if (vp8.length > 0) {
            t.setCodecPreferences([...vp8, ...rest])
          }
        }
      }
    } catch {
      // setCodecPreferences not supported on older browsers — ignore
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
            const local = stats.get(cp.localCandidateId) as any
            if (local) {
              foundType = local.candidateType === 'relay' ? 'turn' : 'p2p'
            }
          }
        }
      })
      if (foundType !== peer.lastStatsType) {
        peer.lastStatsType = foundType
        this.callbacks?.onConnectionType(peerId, foundType)
      }
    } catch {}
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
        const avg = data.reduce((s, v) => s + v, 0) / data.length / 255
        this.callbacks?.onAudioLevel(peerId, avg)
        peer.audioLevelChecker = requestAnimationFrame(check) as unknown as number
      }
      check()
    } catch {}
  }
}

// The singleton instance
let callManagerInstance: CallManager | null = null

export function getCallManager(): CallManager {
  if (!callManagerInstance) {
    callManagerInstance = new CallManager()
  }
  return callManagerInstance
}
