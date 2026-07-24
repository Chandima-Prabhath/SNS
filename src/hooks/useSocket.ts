'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { Socket } from 'socket.io-client'
import { getSocket, disconnectSocket } from '@/lib/socket'
import { registerGlobalCallListeners } from '@/lib/webrtc'

/**
 * Singleton socket connection bound to the current session.
 *
 * The actual socket state is set asynchronously inside the effect callback
 * (allowed by React 19's set-state-in-effect rule). We DERIVE the effective
 * socket/connected values from the session status synchronously during render,
 * so callers see `null` immediately when logged out.
 *
 * IMPORTANT: This hook also registers GLOBAL call listeners (call:incoming,
 * call:cancel, call:reject, call:accept) so that incoming DM call rings
 * arrive even when the user is NOT in a call. Without this, the
 * IncomingCallOverlay would never receive rings.
 */
export function useSocket() {
  const { status } = useSession()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') {
      disconnectSocket()
      return
    }

    let cancelled = false
    getSocket()
      .then((s) => {
        if (cancelled) return
        setSocket(s)
        setConnected(s.connected)

        // Register GLOBAL call listeners ONCE — these handle incoming DM call
        // rings even when the user isn't in a call. The VoiceCallManager
        // registers its own (call-scoped) listeners separately when a call starts.
        registerGlobalCallListeners(s)

        const onConnect = () => setConnected(true)
        const onDisconnect = () => setConnected(false)
        s.on('connect', onConnect)
        s.on('disconnect', onDisconnect)
      })
      .catch((e) => console.error('[useSocket] connect failed', e))

    return () => {
      cancelled = true
    }
  }, [status])

  const effectiveSocket = status === 'authenticated' ? socket : null
  const effectiveConnected = status === 'authenticated' ? connected : false

  return { socket: effectiveSocket, connected: effectiveConnected }
}
