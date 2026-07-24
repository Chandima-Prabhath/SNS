'use client'

import { io, Socket } from 'socket.io-client'
import { useSession } from 'next-auth/react'

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

/**
 * Get the singleton Socket.io connection.
 * Auth is attached on first connect via the session cookie (server-side reads it).
 */
export function getSocket(): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket)
  if (connecting) return connecting

  connecting = new Promise<Socket>((resolve, reject) => {
    const instance = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
      withCredentials: true,
    })

    instance.on('connect', () => resolve(instance))
    instance.on('connect_error', (err) => {
      console.error('[socket] connect_error', err.message)
      // reject only on first attempt; subsequent retries handled by socket.io
      if (!socket) reject(err)
    })

    socket = instance
  })

  return connecting
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    connecting = null
  }
}
