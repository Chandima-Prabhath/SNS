'use client'

import { useEffect } from 'react'
import { getCallManager, unlockAudio } from '@/lib/call-manager'
import { useCallStore } from '@/stores/useCallStore'
import { useSocket } from '@/hooks/useSocket'

/**
 * CallController — mounted ONCE at the app root.
 *
 * This is the single source of truth between the CallManager singleton and
 * the Zustand call store. It:
 *   1. Gives the manager the socket connection
 *   2. Sets up callbacks that update the store
 *   3. Fetches ICE servers
 *   4. Registers the global audio unlock listener
 *
 * Components below read from the store (via useCall hook) and call the
 * manager directly (via getCallManager()). There's only ONE manager instance.
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

  return <>{children}</>
}
