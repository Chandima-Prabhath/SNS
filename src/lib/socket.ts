'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let connecting: Promise<Socket> | null = null

/**
 * Get the singleton Socket.io connection.
 *
 * Single-port architecture: Socket.io is mounted at `/api/socket` on the SAME
 * origin as the Next.js app. No cross-port routing needed — works perfectly
 * behind a single Cloudflare Tunnel.
 *
 * Auth: browser cookies are sent automatically via `withCredentials: true`.
 * The server reads the NextAuth session cookie from `socket.handshake.headers.cookie`.
 */
export function getSocket(): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket)
  if (connecting) return connecting

  connecting = new Promise<Socket>((resolve, reject) => {
    const instance = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
      withCredentials: true, // sends the NextAuth cookie automatically
    })

    instance.on('connect', () => resolve(instance))
    instance.on('connect_error', (err) => {
      console.error('[socket] connect_error', err.message)
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
