'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { Socket } from 'socket.io-client'
import { getSocket, disconnectSocket } from '@/lib/socket'

/**
 * Singleton socket connection bound to the current session.
 *
 * The actual socket state is set asynchronously inside the effect callback
 * (allowed by React 19's set-state-in-effect rule). We DERIVE the effective
 * socket/connected values from the session status synchronously during render,
 * so callers see `null` immediately when logged out.
 */
export function useSocket() {
  const { status } = useSession()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') {
      // Clean up but don't setState synchronously — derived value below handles it.
      disconnectSocket()
      return
    }

    let cancelled = false
    getSocket()
      .then((s) => {
        if (cancelled) return
        setSocket(s)
        setConnected(s.connected)
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

  // Derive effective values — null/false whenever not authenticated
  const effectiveSocket = status === 'authenticated' ? socket : null
  const effectiveConnected = status === 'authenticated' ? connected : false

  return { socket: effectiveSocket, connected: effectiveConnected }
}
