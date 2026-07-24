'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSocket } from './useSocket'
import { VoiceCallManager } from '@/lib/webrtc'
import { useCallStore } from '@/stores/useCallStore'

export interface IceServerInfo {
  iceServers: RTCIceServer[]
  turnEnabled: boolean
  stunUrl: string
}

export function useVoiceCall() {
  const { socket, connected } = useSocket()
  const callStore = useCallStore()
  const managerRef = useRef<VoiceCallManager | null>(null)
  const [iceServers, setIceServers] = useState<IceServerInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch ICE servers once on mount
  useEffect(() => {
    fetch('/api/calls/ice-servers')
      .then((r) => r.json())
      .then(setIceServers)
      .catch(() => {})
  }, [])

  const startCall = useCallback(
    async (params: { callId: string; channelId?: string | null; dmGroupId?: string | null }) => {
      if (!socket || !connected) {
        setError('Socket not connected')
        return
      }
      if (!iceServers) {
        setError('ICE servers not loaded')
        return
      }
      try {
        setError(null)
        const manager = new VoiceCallManager({
          socket,
          callId: params.callId,
          iceServers: iceServers.iceServers,
          callbacks: {
            onLocalStream: (stream) => {
              callStore.start({
                callId: params.callId,
                channelId: params.channelId,
                dmGroupId: params.dmGroupId,
                localStream: stream,
              })
            },
            onRemoteStream: (peerId, stream, meta) => {
              callStore.addPeer(peerId, { userId: meta.userId, username: meta.username })
              callStore.setPeerStream(peerId, stream)
            },
            onPeerLeft: (peerId) => {
              callStore.removePeer(peerId)
            },
            onStateChange: (state) => {
              callStore.setStatus(state)
            },
            onMuteChange: (muted) => {
              callStore.setLocalMuted(muted)
            },
          },
        })
        managerRef.current = manager
        await manager.start(true)
      } catch (e: any) {
        setError(e.message || 'Failed to start call')
      }
    },
    [socket, connected, iceServers, callStore]
  )

  const toggleMute = useCallback(() => {
    if (!managerRef.current) return
    managerRef.current.setMuted(!managerRef.current.isMuted())
  }, [])

  const leaveCall = useCallback(async () => {
    if (managerRef.current) {
      await managerRef.current.leave()
      managerRef.current = null
    }
    if (callStore.callId) {
      try {
        await fetch(`/api/calls/${callStore.callId}`, { method: 'DELETE' })
      } catch {}
    }
    callStore.end()
  }, [callStore])

  return {
    status: callStore.status,
    callId: callStore.callId,
    localStream: callStore.localStream,
    localMuted: callStore.localMuted,
    participants: callStore.participants,
    iceServers,
    error,
    startCall,
    toggleMute,
    leaveCall,
  }
}
