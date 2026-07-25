'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useSocket } from './useSocket'
import { VoiceCallManager } from '@/lib/webrtc'
import { useCallStore } from '@/stores/useCallStore'

export interface IceServerInfo {
  iceServers: RTCIceServer[]
  providers?: any[]
  stun?: string
}

export function useVoiceCall() {
  const { socket, connected } = useSocket()
  const callStore = useCallStore()
  const managerRef = useRef<VoiceCallManager | null>(null)
  const [iceServers, setIceServers] = useState<IceServerInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep a ref to the current callId so leaveCall always has the latest value
  const callIdRef = useRef<string | null>(null)
  useEffect(() => {
    callIdRef.current = callStore.callId
  }, [callStore.callId])

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
              console.log('[useVoiceCall] onMuteChange:', muted)
              callStore.setLocalMuted(muted)
            },
            onAudioLevel: (peerId, level) => {
              window.dispatchEvent(new CustomEvent('sns:audio-level', { detail: { peerId, level } }))
            },
            onConnectionType: (peerId, type) => {
              window.dispatchEvent(new CustomEvent('sns:connection-type', { detail: { peerId, type } }))
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
    if (!managerRef.current) {
      console.warn('[useVoiceCall] toggleMute: no manager')
      return
    }
    const currentlyMuted = managerRef.current.isMuted()
    console.log('[useVoiceCall] toggleMute: currently', currentlyMuted, '->', !currentlyMuted)
    managerRef.current.setMuted(!currentlyMuted)
  }, [])

  const unlockAudio = useCallback(() => {
    managerRef.current?.unlockAudio()
  }, [])

  const leaveCall = useCallback(async () => {
    console.log('[useVoiceCall] leaveCall called, callId:', callIdRef.current)

    // 1. Stop all tracks and close peer connections
    if (managerRef.current) {
      try {
        await managerRef.current.leave()
        console.log('[useVoiceCall] manager.leave() done')
      } catch (e) {
        console.error('[useVoiceCall] manager.leave() error:', e)
      }
      managerRef.current = null
    }

    // 2. Notify the server to end the call
    const callId = callIdRef.current
    if (callId) {
      try {
        const res = await fetch(`/api/calls/${callId}`, { method: 'DELETE' })
        console.log('[useVoiceCall] DELETE /api/calls/' + callId, '->', res.status)
        const data = await res.json().catch(() => ({}))
        console.log('[useVoiceCall] call ended on server:', data)
      } catch (e) {
        console.error('[useVoiceCall] DELETE call error:', e)
      }
    }

    // 3. Reset the call store (this hides the active call screen)
    callStore.end()
    console.log('[useVoiceCall] call store reset')
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
    unlockAudio,
    leaveCall,
  }
}
