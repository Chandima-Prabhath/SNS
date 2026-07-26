'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { Socket } from 'socket.io-client'
import { getSocket, disconnectSocket } from '@/lib/socket'
import { getCallManager, unlockAudio } from '@/lib/call-manager'

/**
 * Singleton socket connection bound to the current session.
 *
 * Also gives the socket to the CallManager singleton so it can register
 * its global call listeners (incoming call, accept, reject, etc).
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

        // Give the socket to the CallManager — it registers global call
        // listeners (call:incoming, call:cancel, call:reject, call:accept,
        // call:ended) internally.
        getCallManager().setSocket(s)

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

  const effectiveSocket = status === 'authenticated' ? socket : null
  const effectiveConnected = status === 'authenticated' ? connected : false

  return { socket: effectiveSocket, connected: effectiveConnected }
}
