'use client'

/**
 * WebRTC voice call manager.
 *
 * Mesh topology (each peer connects to every other peer directly).
 * Works well for ≤4–6 participants. For larger calls you'd want an SFU.
 *
 * Signaling is done via Socket.io events:
 *   call:offer, call:answer, call:ice-candidate, call:peer-joined, call:peer-left
 *
 * Media flows directly peer-to-peer (or via TURN if STUN can't punch through).
 */
import type { Socket } from 'socket.io-client'

export interface VoiceCallCallbacks {
  onLocalStream: (stream: MediaStream) => void
  onRemoteStream: (peerId: string, stream: MediaStream, meta: { userId: string; username: string }) => void
  onPeerLeft: (peerId: string) => void
  onStateChange: (state: 'connecting' | 'connected' | 'failed' | 'disconnected') => void
  onMuteChange?: (muted: boolean) => void
}

export class VoiceCallManager {
  private socket: Socket
  private callId: string
  private callbacks: VoiceCallCallbacks
  private localStream: MediaStream | null = null
  private peers: Map<string, { pc: RTCPeerConnection; userId: string; username: string }> = new Map()
  private iceServers: RTCIceServer[]
  private muted = false

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
      // The new peer initiates the offer to existing peers
      await this.createPeerConnection(payload.peerId, payload.userId, payload.username, true)
    })

    this.socket.on('call:peers', async (payload: { peers: string[] }) => {
      // We just joined — `peers` is the list of socket IDs already in the call.
      // Existing peers will initiate offers to us via `call:peer-joined`.
    })

    this.socket.on('call:offer', async (payload: { from: string; sdp: any }) => {
      let peer = this.peers.get(payload.from)
      if (!peer) {
        // We don't know who this is yet — create PC without userId (we'll learn it from peer-joined)
        // In practice, peer-joined arrives first; this is a safety fallback.
        return
      }
      await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
      const answer = await peer.pc.createAnswer()
      await peer.pc.setLocalDescription(answer)
      this.socket.emit('call:answer', { to: payload.from, sdp: answer })
    })

    this.socket.on('call:answer', async (payload: { from: string; sdp: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
    })

    this.socket.on('call:ice-candidate', async (payload: { from: string; candidate: any }) => {
      const peer = this.peers.get(payload.from)
      if (!peer) return
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
      } catch (e) {
        console.error('[webrtc] addIceCandidate error', e)
      }
    })

    this.socket.on('call:peer-left', (payload: { peerId: string; userId: string }) => {
      this.removePeer(payload.peerId)
      this.callbacks.onPeerLeft(payload.peerId)
    })
  }

  private async createPeerConnection(peerId: string, userId: string, username: string, initiator: boolean) {
    if (this.peers.has(peerId)) return

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })

    // Add local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream)
      }
    }

    // Remote stream
    const remoteStream = new MediaStream()
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t))
      this.callbacks.onRemoteStream(peerId, remoteStream, { userId, username })
    }

    // ICE candidates → trickle
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('call:ice-candidate', { to: peerId, candidate: event.candidate })
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      if (state === 'connected' || state === 'completed') {
        this.callbacks.onStateChange('connected')
      } else if (state === 'failed') {
        this.callbacks.onStateChange('failed')
        // Try ICE restart
        pc.restartIce()
      } else if (state === 'disconnected') {
        this.callbacks.onStateChange('disconnected')
      }
    }

    this.peers.set(peerId, { pc, userId, username })

    if (initiator) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
      await pc.setLocalDescription(offer)
      this.socket.emit('call:offer', { to: peerId, sdp: offer })
    }
  }

  async start(micEnabled: boolean = true): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })
      if (!micEnabled) this.setMuted(true)
      this.callbacks.onLocalStream(this.localStream)
      this.callbacks.onStateChange('connecting')
      this.socket.emit('call:join', this.callId)
    } catch (e: any) {
      console.error('[webrtc] getUserMedia error', e)
      throw e
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => (t.enabled = !muted))
    }
    this.callbacks.onMuteChange?.(muted)
  }

  isMuted() {
    return this.muted
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId)
    if (peer) {
      peer.pc.close()
      this.peers.delete(peerId)
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
    // Remove all listeners we set
    this.socket.removeAllListeners('call:peer-joined')
    this.socket.removeAllListeners('call:peers')
    this.socket.removeAllListeners('call:offer')
    this.socket.removeAllListeners('call:answer')
    this.socket.removeAllListeners('call:ice-candidate')
    this.socket.removeAllListeners('call:peer-left')
  }
}
