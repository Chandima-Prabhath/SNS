/**
 * SNS Realtime — Socket.io server setup
 *
 * Single-port architecture: this module exports a function that attaches a
 * Socket.io server to an existing Node.js httpServer. We use this from
 * `server.ts` (custom Next.js server) so that the Next.js app and the realtime
 * service share the SAME port. No more separate mini-service, no more
 * XTransformPort query param.
 *
 * Responsibilities (kept intentionally narrow — this is a dumb relay):
 *   1. Chat relay       — message, edit, delete, typing, read receipts
 *   2. Presence         — online/idle/dnd/offline broadcast
 *   3. Voice signaling  — WebRTC offer/answer/ICE relay only (never media)
 *
 * Auth: client sends the NextAuth session cookie via `withCredentials: true`.
 * The middleware reads it from `socket.handshake.headers.cookie` and decodes
 * the JWT directly (no HTTP roundtrip to NextAuth — single-process friendly).
 */
import type { Server as HTTPServer } from 'http'
import { Server as IOServer } from 'socket.io'
import jwt from 'next-auth/jwt'
import type { NextApiRequest } from 'next'

const SOCKET_PATH = '/api/socket'

interface AuthenticatedSocket {
  userId?: string
  username?: string
}

// in-memory presence map (userId → { status, socketIds[], username })
const presence = new Map<string, { status: string; socketIds: Set<string>; username: string }>()

let ioRef: IOServer | null = null

export function getIO(): IOServer | null {
  return ioRef
}

export function attachRealtime(httpServer: HTTPServer): IOServer {
  if (ioRef) return ioRef

  const io = new IOServer(httpServer, {
    path: SOCKET_PATH,
    cors: {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    // Allow large SDP payloads (WebRTC offer/answer can be 5-10KB)
    maxHttpBufferSize: 1e6,
  })
  ioRef = io

  // ─────────────────────────────────────────────────────────────────────────
  // Auth middleware — decode NextAuth JWT from cookie
  // ─────────────────────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie || ''
      // Parse cookies into a plain object (small helper, avoids extra dep)
      const cookies: Record<string, string> = {}
      for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=')
        if (idx === -1) continue
        const k = part.slice(0, idx).trim()
        const v = part.slice(idx + 1).trim()
        cookies[k] = decodeURIComponent(v)
      }

      // NextAuth JWT cookie name depends on env:
      //   dev:      next-auth.session-token
      //   prod TLS: __Secure-next-auth.session-token
      const tokenRaw =
        cookies['__Secure-next-auth.session-token'] ||
        cookies['next-auth.session-token']

      if (!tokenRaw) {
        return next(new Error('unauthorized: no session cookie'))
      }

      // Decode the JWT. We don't have a real Request here, so we shim one.
      // next-auth/jwt.decode only needs secret + token.
      const secret = process.env.NEXTAUTH_SECRET
      if (!secret) {
        return next(new Error('server misconfigured: NEXTAUTH_SECRET missing'))
      }

      const decoded = await jwt.decode({
        token: tokenRaw,
        secret,
      } as any)

      if (!decoded || !decoded.id) {
        return next(new Error('unauthorized: invalid session'))
      }

      ;(socket as any).userId = decoded.id
      ;(socket as any).username = decoded.username || decoded.email || 'user'
      next()
    } catch (e: any) {
      console.error('[realtime auth] error:', e.message)
      next(new Error('unauthorized'))
    }
  })

  function broadcastPresence() {
    const list = Array.from(presence.entries()).map(([id, p]) => ({
      userId: id,
      username: p.username,
      status: p.status,
    }))
    io.emit('presence:update', list)
  }

  function setPresence(userId: string, username: string, status: string, socketId: string) {
    const existing = presence.get(userId)
    if (existing) {
      existing.socketIds.add(socketId)
      existing.status = status
      existing.username = username
    } else {
      presence.set(userId, { status, username, socketIds: new Set([socketId]) })
    }
    broadcastPresence()
  }

  function removeSocket(userId: string, socketId: string) {
    const p = presence.get(userId)
    if (!p) return
    p.socketIds.delete(socketId)
    if (p.socketIds.size === 0) {
      presence.delete(userId)
    }
    broadcastPresence()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ─────────────────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const auth = socket as unknown as AuthenticatedSocket & { userId: string; username: string }
    const { userId, username } = auth
    console.log(`[realtime] connect ${username} (${userId})`)

    setPresence(userId, username, 'online', socket.id)

    // ─── Chat channel subscriptions ──────────────────────────────────────
    socket.on('channel:join', (channelId: string) => {
      socket.join(`channel:${channelId}`)
    })

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`)
    })

    socket.on('channel:message', (payload: { channelId: string; message: any }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:message', payload.message)
    })

    socket.on('channel:message-edit', (payload: { channelId: string; message: any }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:message-edit', payload.message)
    })

    socket.on('channel:message-delete', (payload: { channelId: string; messageId: string }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:message-delete', {
        messageId: payload.messageId,
      })
    })

    socket.on('channel:typing', (payload: { channelId: string; isTyping: boolean }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:typing', {
        userId,
        username,
        channelId: payload.channelId,
        isTyping: payload.isTyping,
      })
    })

    socket.on('channel:read', (payload: { channelId: string; messageId: string }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:read', {
        userId,
        channelId: payload.channelId,
        messageId: payload.messageId,
      })
    })

    // ─── Status / Stories ────────────────────────────────────────────────
    socket.on('story:posted', (payload: { story: any }) => {
      socket.broadcast.emit('story:posted', payload.story)
    })

    socket.on('story:viewed', (payload: { storyId: string; userId: string }) => {
      socket.broadcast.emit('story:viewed', payload)
    })

    // ─── Voice call signaling (WebRTC) ───────────────────────────────────
    socket.on('call:join', (callId: string) => {
      socket.join(`call:${callId}`)
      socket.to(`call:${callId}`).emit('call:peer-joined', {
        peerId: socket.id,
        userId,
        username,
      })
      const peers = Array.from(io.sockets.adapter.rooms.get(`call:${callId}`) || []).filter(
        (id) => id !== socket.id
      )
      socket.emit('call:peers', { peers })
    })

    socket.on('call:leave', (callId: string) => {
      socket.leave(`call:${callId}`)
      socket.to(`call:${callId}`).emit('call:peer-left', {
        peerId: socket.id,
        userId,
      })
    })

    socket.on('call:offer', (payload: { to: string; sdp: any }) => {
      io.to(payload.to).emit('call:offer', { from: socket.id, sdp: payload.sdp })
    })

    socket.on('call:answer', (payload: { to: string; sdp: any }) => {
      io.to(payload.to).emit('call:answer', { from: socket.id, sdp: payload.sdp })
    })

    socket.on('call:ice-candidate', (payload: { to: string; candidate: any }) => {
      io.to(payload.to).emit('call:ice-candidate', { from: socket.id, candidate: payload.candidate })
    })

    // ─── Presence management ─────────────────────────────────────────────
    socket.on('presence:set', (status: string) => {
      setPresence(userId, username, status, socket.id)
    })

    socket.on('presence:request', () => {
      const list = Array.from(presence.entries()).map(([id, p]) => ({
        userId: id,
        username: p.username,
        status: p.status,
      }))
      socket.emit('presence:update', list)
    })

    socket.on('disconnect', () => {
      removeSocket(userId, socket.id)
      console.log(`[realtime] disconnect ${username} (${userId})`)
    })

    socket.on('error', (err: any) => {
      console.error(`[realtime] socket error ${userId}:`, err)
    })
  })

  console.log(`[realtime] attached, path=${SOCKET_PATH}`)
  return io
}
