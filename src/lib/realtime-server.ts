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

      // Tell everyone already in the call that we joined (so they can offer)
      socket.to(`call:${callId}`).emit('call:peer-joined', {
        peerId: socket.id,
        userId,
        username,
      })

      // Tell the joiner who's already in the call.
      // We need to look up each socket's userId/username — the socket.handshake.auth
      // gives us our own, but for others we need a lookup. We use the presence map
      // (userId → socketIds) in reverse, but that's awkward. Instead, we maintain
      // a socketId → {userId, username} map on the io instance.
      const roomSocketIds = Array.from(io.sockets.adapter.rooms.get(`call:${callId}`) || []).filter(
        (id) => id !== socket.id
      )
      const peers = roomSocketIds.map((sid) => {
        const otherSocket = io.sockets.sockets.get(sid) as any
        return {
          peerId: sid,
          userId: otherSocket?.userId || '',
          username: otherSocket?.username || 'user',
        }
      })
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

    // ─── DM call ringing (for 1:1 calls) ─────────────────────────────────
    // The caller rings a specific user via their socket connection(s).
    // We look up all sockets for that userId (via the presence map) and forward.
    socket.on('call:ring', (payload: {
      callId: string
      targetUserId: string
      from: { userId: string; username: string; displayName: string }
      channelId?: string
      dmGroupId?: string
    }) => {
      // Find all sockets owned by targetUserId
      const targetPresence = presence.get(payload.targetUserId)
      if (!targetPresence) {
        // Target is offline — notify caller via a 'reject' with reason 'offline'
        socket.emit('call:reject', { callId: payload.callId, byUserId: payload.targetUserId, reason: 'offline' })
        return
      }
      for (const sid of targetPresence.socketIds) {
        io.to(sid).emit('call:incoming', {
          callId: payload.callId,
          from: payload.from,
          channelId: payload.channelId,
          dmGroupId: payload.dmGroupId,
        })
      }
    })

    socket.on('call:accept', (payload: { callId: string; byUserId: string }) => {
      // Notify all of caller's sockets that the call was accepted
      const callerSockets = presence.get(payload.byUserId)
      if (callerSockets) {
        for (const sid of callerSockets.socketIds) {
          io.to(sid).emit('call:accept', { callId: payload.callId, byUserId })
        }
      }
    })

    socket.on('call:reject', (payload: { callId: string; byUserId: string; reason?: string }) => {
      const callerSockets = presence.get(payload.byUserId)
      if (callerSockets) {
        for (const sid of callerSockets.socketIds) {
          io.to(sid).emit('call:reject', { callId: payload.callId, reason: payload.reason || 'rejected' })
        }
      }
    })

    socket.on('call:cancel', (payload: { callId: string; targetUserId: string }) => {
      // Caller is cancelling an outgoing ring
      const targetSockets = presence.get(payload.targetUserId)
      if (targetSockets) {
        for (const sid of targetSockets.socketIds) {
          io.to(sid).emit('call:cancel', { callId: payload.callId })
        }
      }
    })

    // ─── Push notifications: server pushes new messages to all of a user's ─
    // sessions so they get unread badges / notifications regardless of which
    // screen they're on. Persistent socket connection = real-time notifications.
    socket.on('notify:user', (payload: { userId: string; type: string; data: any }) => {
      const targetPresence = presence.get(payload.userId)
      if (!targetPresence) return
      for (const sid of targetPresence.socketIds) {
        // Don't echo back to the sender's own socket
        if (sid === socket.id) continue
        io.to(sid).emit('notify', { type: payload.type, data: payload.data })
      }
    })

    // Broadcast a new message to all members of a channel (server-side driven,
    // not just relying on the sender's socket to relay)
    socket.on('channel:broadcast-message', (payload: { channelId: string; message: any; recipientIds: string[] }) => {
      for (const uid of payload.recipientIds) {
        const targetPresence = presence.get(uid)
        if (!targetPresence) continue
        for (const sid of targetPresence.socketIds) {
          if (sid === socket.id) continue // skip sender
          io.to(sid).emit('channel:message', payload.message)
          io.to(sid).emit('notify', {
            type: 'message',
            data: {
              channelId: payload.channelId,
              messageId: payload.message.id,
              senderId: payload.message.senderId,
              senderName: payload.message.sender?.displayName || payload.message.sender?.username,
              body: payload.message.body,
              senderType: payload.message.senderType,
            },
          })
        }
      }
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
