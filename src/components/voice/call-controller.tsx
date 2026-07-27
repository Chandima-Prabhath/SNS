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
 * registers global audio unlock, and checks for pending calls on load/reconnect.
 */
export function CallController({ children }: { children: React.ReactNode }) {
  const { socket, connected } = useSocket()

  // Wire manager callbacks to store + give it the socket
  useEffect(() => {
    const manager = getCallManager()
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
    if (socket) {
      manager.setSocket(socket)
    }
  }, [socket])

  // Fetch ICE servers
  useEffect(() => {
    fetch('/api/calls/ice-servers')
      .then((r) => r.json())
      .then((data) => { getCallManager().setIceServers(data.iceServers || []) })
      .catch(() => {})
  }, [])

  // Global audio unlock
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

  // Call accept/reject listeners — stop ringback
  useEffect(() => {
    const onAccepted = () => { CallSounds.stop() }
    const onRejected = () => { CallSounds.stop() }
    window.addEventListener('sns:call-accepted', onAccepted)
    window.addEventListener('sns:call-rejected', onRejected)
    return () => {
      window.removeEventListener('sns:call-accepted', onAccepted)
      window.removeEventListener('sns:call-rejected', onRejected)
    }
  }, [])

  // CRITICAL: Check for pending calls on load and on socket reconnect.
  // This handles the case where the app was closed, a call notification arrived,
  // and the user opens the app — the call:incoming socket event was missed.
  useEffect(() => {
    if (!connected) return

    // Check for pending calls
    fetch('/api/calls/pending')
      .then((r) => r.json())
      .then((data) => {
        if (data.calls && data.calls.length > 0) {
          const call = data.calls[0]
          console.log('[CallController] found pending call:', call.id)

          // Only show the incoming call overlay if we're not already in a call
          const currentStatus = useCallStore.getState().status
          if (currentStatus === 'idle') {
            // Dispatch the incoming call event — same as if the socket delivered it
            const payload = {
              callId: call.id,
              from: {
                userId: call.starter.id,
                username: call.starter.username,
                displayName: call.starter.displayName,
              },
              channelId: call.channel?.id,
              video: false, // We don't track video in the call record — assume voice
            }
            window.dispatchEvent(new CustomEvent('sns:incoming-call', { detail: payload }))

            // Play the incoming ring sound
            CallSounds.unlock()
            CallSounds.startIncoming()
          }
        }
      })
      .catch(() => {})
  }, [connected])

  // SW notification click listener
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'notification_click') return

      console.log('[CallController] notification click:', data)

      if (data.action === 'decline' && data.callId) {
        import('@/lib/socket').then(({ getSocket }) => {
          getSocket().then(socket => {
            socket.emit('call:reject', { callId: data.callId, byUserId: data.from?.userId })
          })
        })
      }

      // Navigate based on notification type
      import('@/stores/useAppStore').then(({ useAppStore }) => {
        if (data.type === 'message' && data.channelId) {
          useAppStore.getState().setView('chats')
          useAppStore.getState().setActiveChannel(data.channelId)
        } else if (data.type === 'call') {
          useAppStore.getState().setView('voice')
        }
      })
    }

    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [])

  return <>{children}</>
}
