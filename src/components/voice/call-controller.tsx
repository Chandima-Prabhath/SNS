'use client'

import { useEffect } from 'react'
import { getCallManager, unlockAudio } from '@/lib/call-manager'
import { CallSounds } from '@/lib/call-sounds'
import { useCallStore } from '@/stores/useCallStore'
import { useSocket } from '@/hooks/useSocket'

/**
 * CallController — mounted ONCE at the app root.
 *
 * Wires the CallManager singleton to the Zustand store, fetches ICE servers,
 * and registers global audio unlock + call event listeners.
 */
export function CallController({ children }: { children: React.ReactNode }) {
  const { socket, connected } = useSocket()

  useEffect(() => {
    const manager = getCallManager()

    // Wire the manager's callbacks to the store
    manager.setCallbacks({
      onStatusChange: (status) => useCallStore.getState().setStatus(status),
      onLocalStream: (stream) => useCallStore.getState().setLocalStream(stream),
      onParticipantsChange: (participants) => useCallStore.getState().setParticipants(participants),
      onMuteChange: (muted) => useCallStore.getState().setLocalMuted(muted),
      onVideoToggle: (enabled) => useCallStore.getState().setVideoEnabled(enabled),
      onConnectionType: (peerId, type) => {
        window.dispatchEvent(new CustomEvent('sns:connection-type', { detail: { peerId, type } }))
      },
      onAudioLevel: (peerId, level) => {
        window.dispatchEvent(new CustomEvent('sns:audio-level', { detail: { peerId, level } }))
      },
      onIncomingCall: (payload) => {
        window.dispatchEvent(new CustomEvent('sns:incoming-call', { detail: payload }))
      },
      onCallEnded: (reason) => {
        console.log('[CallController] call ended:', reason)
        useCallStore.getState().reset()
      },
    })

    // Give the manager the socket
    if (socket) {
      manager.setSocket(socket)
    }
  }, [socket])

  // Fetch ICE servers
  useEffect(() => {
    fetch('/api/calls/ice-servers')
      .then((r) => r.json())
      .then((data) => {
        getCallManager().setIceServers(data.iceServers || [])
      })
      .catch(() => {})
  }, [])

  // Global audio unlock on first user gesture
  useEffect(() => {
    const unlock = () => {
      unlockAudio()
      CallSounds.unlock()
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('keydown', unlock)
    }
    document.addEventListener('click', unlock, { once: true })
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('keydown', unlock, { once: true })
    return () => {
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])

  // Listen for call accept/reject to stop ringback on the caller's side
  useEffect(() => {
    const onAccepted = () => {
      console.log('[CallController] call accepted — stopping ringback')
      CallSounds.stop()
    }
    const onRejected = () => {
      console.log('[CallController] call rejected — stopping ringback')
      CallSounds.stop()
    }
    window.addEventListener('sns:call-accepted', onAccepted)
    window.addEventListener('sns:call-rejected', onRejected)
    return () => {
      window.removeEventListener('sns:call-accepted', onAccepted)
      window.removeEventListener('sns:call-rejected', onRejected)
    }
  }, [])

  return <>{children}</>
}
