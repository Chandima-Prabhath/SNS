/**
 * Adoo Realtime — Socket.io server setup
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
import { db } from '@/lib/db'

const SOCKET_PATH = '/api/socket'

interface AuthenticatedSocket {
  userId?: string
  username?: string
}

// in-memory presence map (userId → { status, socketIds[], username })
const presence = new Map<string, { status: string; socketIds: Set<string>; username: string }>()

// Use globalThis to share the io instance across Next.js module contexts.
// In dev mode, Next.js API routes can load a DIFFERENT copy of this module
// than the one server.ts initialized — so a module-level `let ioRef` would
// be null in the API route context. globalThis is shared across all module
// instances in the same Node.js process.
const globalForIo = globalThis as unknown as { __adoo_io?: IOServer | null }

export function getIO(): IOServer | null {
  return globalForIo.__adoo_io || null
}

export function attachRealtime(httpServer: HTTPServer): IOServer {
  if (globalForIo.__adoo_io) return globalForIo.__adoo_io

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
  globalForIo.__adoo_io = io

  // ─────────────────────────────────────────────────────────────────────────
  // Auth middleware — decode NextAuth JWT from cookie
  // ─────────────────────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie || ''
      console.log('[realtime auth] cookie header present:', !!cookieHeader, 'length:', cookieHeader.length)

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
        console.log('[realtime auth] no session cookie found. Available cookies:', Object.keys(cookies))
        return next(new Error('unauthorized: no session cookie'))
      }

      // Decode the JWT. We don't have a real Request here, so we shim one.
      // next-auth/jwt.decode only needs secret + token.
      const secret = process.env.NEXTAUTH_SECRET
      if (!secret) {
        console.error('[realtime auth] NEXTAUTH_SECRET is not set in environment!')
        return next(new Error('server misconfigured: NEXTAUTH_SECRET missing'))
      }

      const decoded = await jwt.decode({
        token: tokenRaw,
        secret,
      } as any)

      if (!decoded || !decoded.id) {
        console.log('[realtime auth] JWT decode returned null or missing id. decoded:', decoded ? Object.keys(decoded) : 'null')
        return next(new Error('unauthorized: invalid session'))
      }

      ;(socket as any).userId = decoded.id
      ;(socket as any).username = decoded.username || decoded.email || 'user'
      console.log('[realtime auth] success: userId=', decoded.id, 'username=', (socket as any).username)
      next()
    } catch (e: any) {
      console.error('[realtime auth] error:', e?.message || e, e?.stack?.slice(0, 200))
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

  /**
   * Check if a call should end (fewer than 2 participants).
   * If so, notify all remaining participants and mark the call as ended.
   */
  function checkCallEnd(callId: string) {
    const room = io.sockets.adapter.rooms.get(`call:${callId}`)
    const participantCount = room ? room.size : 0

    if (participantCount < 2) {
      // Notify any remaining participant (or none) that the call ended
      io.to(`call:${callId}`).emit('call:ended', {
        callId,
        reason: participantCount === 0 ? 'all_left' : 'insufficient_participants',
      })

      // Make remaining sockets leave the room
      if (room) {
        for (const sid of room) {
          const s = io.sockets.sockets.get(sid)
          s?.leave(`call:${callId}`)
        }
      }

      console.log(`[realtime] call ${callId} ended (${participantCount} participants remaining)`)
    }
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
    socket.on('channel:join', async (channelId: string) => {
      // Verify membership before joining the socket room (C8 fix)
      const membership = await db.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId: socket.userId } },
      }).catch(() => null)
      if (membership) {
        socket.join(`channel:${channelId}`)
      }
    })

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`)
    })

    socket.on('channel:message', (payload: { channelId: string; message: any }) => {
      // C9 fix: only broadcast messages from the authenticated user
      if (payload.message?.senderId === userId) {
        socket.to(`channel:${payload.channelId}`).emit('channel:message', payload.message)
      }
    })

    socket.on('channel:message-edit', (payload: { channelId: string; message: any }) => {
      // C9 fix: only broadcast edits for the user's own messages
      if (payload.message?.senderId === userId) {
        socket.to(`channel:${payload.channelId}`).emit('channel:message-edit', payload.message)
      }
    })

    socket.on('channel:message-delete', (payload: { channelId: string; messageId: string }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:message-delete', {
        messageId: payload.messageId,
      })
    })

    socket.on('channel:typing', async (payload: { channelId: string; isTyping: boolean }) => {
      const typingPayload = {
        userId,
        username,
        channelId: payload.channelId,
        isTyping: payload.isTyping,
      }

      // Active viewers (sockets that have joined this channel's room) get the
      // event via the room broadcast — this is the existing fast path.
      socket.to(`channel:${payload.channelId}`).emit('channel:typing', typingPayload)

      // Fan out to ALL channel members via the presence map so the chat list
      // can show "typing..." for channels the user hasn't actively joined.
      //
      // Without this, a member viewing a different channel would never see the
      // typing indicator in their chat list because they're not in the channel
      // room. We fetch the member list from the DB on each typing pulse —
      // typing is debounced client-side to ~1.5s, so this is at most ~0.7 QPS
      // per typist, which SQLite handles easily.
      //
      // We use `volatile` so a slow client connection doesn't queue up stale
      // typing pulses — only the most recent state matters.
      try {
        const members = await db.channelMember.findMany({
          where: { channelId: payload.channelId },
          select: { userId: true },
        })
        for (const m of members) {
          if (m.userId === userId) continue // skip the typist themselves
          const target = presence.get(m.userId)
          if (!target) continue
          for (const sid of target.socketIds) {
            // Skip the sender's own socket (multi-tab: don't echo back)
            if (sid === socket.id) continue
            // Skip sockets already in the channel room — they got it via the
            // room broadcast above and we don't want to double-deliver.
            const s = io.sockets.sockets.get(sid)
            if (s?.rooms.has(`channel:${payload.channelId}`)) continue
            io.to(sid).volatile.emit('channel:typing', typingPayload)
          }
        }
      } catch (e) {
        // Silent — typing is best-effort, don't crash the socket handler.
      }
    })

    socket.on('channel:read', (payload: { channelId: string; messageId: string }) => {
      socket.to(`channel:${payload.channelId}`).emit('channel:read', {
        userId,
        channelId: payload.channelId,
        messageId: payload.messageId,
      })
    })

    // Delivery ACK — when a client receives a message via 'channel:message',
    // it emits 'channel:delivered' back. We update the DB and broadcast to
    // the sender so their UI can show the single-checkmark "delivered" state.
    socket.on('channel:delivered', async (payload: { channelId: string; messageId: string }) => {
      try {
        // Only update if deliveredAt is not already set (avoid redundant writes)
        const msg = await db.message.findUnique({
          where: { id: payload.messageId },
          select: { deliveredAt: true, senderId: true },
        })
        if (!msg || msg.deliveredAt) return  // already delivered or not found
        // Don't ACK your own messages (the sender client also emits this)
        if (msg.senderId === userId) return

        await db.message.update({
          where: { id: payload.messageId },
          data: { deliveredAt: new Date() },
        })

        // Broadcast to the channel (the sender will pick this up and update their UI)
        socket.to(`channel:${payload.channelId}`).emit('channel:delivered', {
          messageId: payload.messageId,
          channelId: payload.channelId,
        })
      } catch (e) {
        // Best-effort — don't let delivery ACK failures break anything
      }
    })

    // ─── Status / Stories ────────────────────────────────────────────────
    socket.on('story:posted', (payload: { story: any }) => {
      socket.broadcast.emit('story:posted', payload.story)
    })

    socket.on('story:viewed', (payload: { storyId: string; userId: string }) => {
      socket.broadcast.emit('story:viewed', payload)
    })

    // ─── Voice call signaling (WebRTC) ───────────────────────────────────
    // The server tracks active calls and their participants. When a call
    // drops below 2 participants, it's auto-ended and everyone is notified.

    socket.on('call:join', (callId: string) => {
      socket.join(`call:${callId}`)

      // Tell everyone already in the call that we joined (so they can offer)
      socket.to(`call:${callId}`).emit('call:peer-joined', {
        peerId: socket.id,
        userId,
        username,
      })

      // Tell the joiner who's already in the call
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

      // Check if the call should end (fewer than 2 participants remain)
      checkCallEnd(callId)
    })

    // Also handle disconnect — user might close the tab
    socket.on('disconnect', () => {
      // Find all calls this socket was in and check if they should end
      for (const room of socket.rooms) {
        if (room.startsWith('call:')) {
          const callId = room.substring(5)
          socket.to(room).emit('call:peer-left', {
            peerId: socket.id,
            userId,
          })
          checkCallEnd(callId)
        }
      }
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
      video?: boolean
    }) => {
      // Send push notification immediately (works even if app is closed)
      import('./push').then(m => {
        m.sendPushNotification(payload.targetUserId, {
          type: 'call',
          title: payload.from.displayName,
          body: `Incoming ${payload.video ? 'video' : 'voice'} call`,
          callId: payload.callId,
          channelId: payload.channelId,
          from: payload.from,
        })
      }).catch(() => {})

      // RETRY: keep sending call:incoming every 5 seconds for up to 1 minute.
      // This handles the case where the app is closed — the push notification
      // wakes it, the socket reconnects, and the next retry delivers the event.
      const incomingPayload = {
        callId: payload.callId,
        from: payload.from,
        channelId: payload.channelId,
        dmGroupId: payload.dmGroupId,
        video: payload.video ?? false,
      }

      // Send immediately
      const sendIncoming = () => {
        const target = presence.get(payload.targetUserId)
        if (target) {
          for (const sid of target.socketIds) {
            io.to(sid).emit('call:incoming', incomingPayload)
          }
        }
      }
      sendIncoming()

      // Retry every 5s for 60s (12 attempts)
      let attempts = 0
      const retryInterval = setInterval(() => {
        attempts++
        if (attempts >= 12) {
          clearInterval(retryInterval)
          return
        }
        // Check if the call is still active
        // (the caller might have cancelled)
        const target = presence.get(payload.targetUserId)
        if (target) {
          // Check if any socket has acknowledged by joining the call room
          const callRoom = io.sockets.adapter.rooms.get(`call:${payload.callId}`)
          if (callRoom && callRoom.size > 0) {
            // Someone joined the call — stop retrying
            clearInterval(retryInterval)
            return
          }
          sendIncoming()
          console.log(`[call] retry ${attempts}/12 sending call:incoming to ${payload.targetUserId}`)
        }
      }, 5000)

      // Clean up interval when caller disconnects
      socket.on('disconnect', () => {
        clearInterval(retryInterval)
      })
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

    // ─── Music room sync ────────────────────────────────────────────────
    // Host-authoritative: the host broadcasts playback state changes to all
    // room members. Members apply the state with drift compensation.
    socket.on('music:join', (roomId: string) => {
      socket.join(`music:${roomId}`)
      // Notify the room that someone joined — the host should respond with
      // a sync broadcast so the new member gets the current state.
      socket.to(`music:${roomId}`).emit('music:member-joined', {
        roomId,
        userId,
        username,
      })
    })

    socket.on('music:leave', (roomId: string) => {
      socket.leave(`music:${roomId}`)
    })

    // Broadcast sync events to all room members.
    // The host sends: { roomId, state, position, videoId?, trackInfo? }
    // We include the server's receive timestamp for drift compensation.
    socket.on('music:sync', (payload: {
      roomId: string
      state: string
      position: number
      videoId?: string
      trackInfo?: any
    }) => {
      io.to(`music:${payload.roomId}`).emit('music:sync', {
        ...payload,
        serverTimestamp: Date.now(),
      })
    })

    // Request sync — a member who just joined asks the host for the current
    // state. The host should respond with a music:sync broadcast.
    socket.on('music:request-sync', (roomId: string) => {
      socket.to(`music:${roomId}`).emit('music:request-sync', {
        roomId,
        fromUserId: userId,
      })
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
