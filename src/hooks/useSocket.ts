'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { Socket } from 'socket.io-client'
import { getSocket, disconnectSocket } from '@/lib/socket'
import { registerGlobalCallListeners, unlockAudio } from '@/lib/webrtc'

/**
 * Singleton socket connection bound to the current session.
 *
 * Also registers GLOBAL call listeners and a global audio unlock listener.
 * The audio unlock is critical: browsers block audio.play() until a user
 * gesture occurs. We listen for the FIRST click/touch/keypress on the page
 * and unlock audio immediately. This way, when a call later starts and
 * ontrack fires, the audio can play without being blocked.
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

  // Global audio unlock: listen for the first user gesture and unlock audio.
  // This ensures that when a call starts (even an incoming call from a socket
  // event, which is NOT a user gesture), the remote audio can play.
  useEffect(() => {
    const unlock = () => {
      unlockAudio()
      // Remove listeners after first unlock — audio stays unlocked for page lifetime
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
