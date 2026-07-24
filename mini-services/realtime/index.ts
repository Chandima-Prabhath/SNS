/**
 * SNS Realtime Service — Socket.io
 *
 * Responsibilities (kept intentionally narrow — this is a dumb relay):
 *   1. Chat relay       — message, edit, delete, typing, read receipts
 *   2. Presence         — online/idle/dnd/offline broadcast
 *   3. Voice signaling  — WebRTC offer/answer/ICE relay only (never media)
 *
 * Auth: client emits `auth` with their session token on connect.
 * The server validates against the Next.js API (GET /api/auth/me) and tags
 * the socket with `userId`. All other events require auth.
 *
 * Layout: one io instance. Channels and calls are Socket.io "rooms".
 *   - chat channel room:   `channel:<channelId>`
 *   - voice call room:     `call:<callId>`
 *
 * Port: 3003 (matches REALTIME_PORT in .env). Caddyfile forwards
 *        `?XTransformPort=3003` to this port.
 */
import { createServer } from 'http'
import { Server } from 'socket.io'

const PORT = 3003
const NEXT_APP_URL = 'http://localhost:3000'

interface AuthenticatedSocket {
  userId?: string
  username?: string
}

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth: validate session token by calling Next.js
// ─────────────────────────────────────────────────────────────────────────────
async function fetchUserId(sessionToken: string | undefined): Promise<{ id: string; username: string } | null> {
  if (!sessionToken) return null
  try {
    const res = await fetch(`${NEXT_APP_URL}/api/auth/me`, {
      headers: {
        cookie: `next-auth.session-token=${sessionToken}`,
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.user?.id) return null
    return { id: data.user.id, username: data.user.username || data.user.email }
  } catch (e) {
    console.error('[auth] error validating session:', e)
    return null
  }
}

// in-memory presence map (userId → { status, socketIds[] })
const presence = new Map<string, { status: string; socketIds: Set<string>; username: string }>()

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

// ─────────────────────────────────────────────────────────────────────────────
// Connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────
io.use(async (socket, next) => {
  const sessionToken = socket.handshake.auth?.sessionToken as string | undefined
  const user = await fetchUserId(sessionToken)
  if (!user) {
    return next(new Error('unauthorized'))
  }
  ;(socket as any).userId = user.id
  ;(socket as any).username = user.username
  next()
})

io.on('connection', (socket) => {
  const auth = socket as unknown as AuthenticatedSocket & { userId: string; username: string }
  const { userId, username } = auth
  console.log(`[connect] ${username} (${userId})`)

  setPresence(userId, username, 'online', socket.id)

  // ─── Chat channel subscriptions ──────────────────────────────────────────
  socket.on('channel:join', (channelId: string) => {
    socket.join(`channel:${channelId}`)
  })

  socket.on('channel:leave', (channelId: string) => {
    socket.leave(`channel:${channelId}`)
  })

  // New message broadcast (the DB write happens via REST; socket only relays)
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

  // Typing indicator — broadcast to others in the channel
  socket.on('channel:typing', (payload: { channelId: string; isTyping: boolean }) => {
    socket.to(`channel:${payload.channelId}`).emit('channel:typing', {
      userId,
      username,
      channelId: payload.channelId,
      isTyping: payload.isTyping,
    })
  })

  // Read receipts — broadcast to others in the channel
  socket.on('channel:read', (payload: { channelId: string; messageId: string }) => {
    socket.to(`channel:${payload.channelId}`).emit('channel:read', {
      userId,
      channelId: payload.channelId,
      messageId: payload.messageId,
    })
  })

  // ─── Status / Stories ────────────────────────────────────────────────────
  socket.on('story:posted', (payload: { story: any }) => {
    // Story visibility is enforced on the client/REST layer; here we just
    // broadcast so any open app can refresh. Recipients filter themselves.
    socket.broadcast.emit('story:posted', payload.story)
  })

  socket.on('story:viewed', (payload: { storyId: string; userId: string }) => {
    socket.broadcast.emit('story:viewed', payload)
  })

  // ─── Voice call signaling (WebRTC) ───────────────────────────────────────
  // Mesh topology for ≤4–6 participants. SFU swap-in later.
  socket.on('call:join', (callId: string) => {
    socket.join(`call:${callId}`)
    // tell others in the call
    socket.to(`call:${callId}`).emit('call:peer-joined', {
      peerId: socket.id,
      userId,
      username,
    })
    // tell the joiner who's already there
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

  // WebRTC signaling — relay to specific peer
  socket.on('call:offer', (payload: { to: string; sdp: any }) => {
    io.to(payload.to).emit('call:offer', { from: socket.id, sdp: payload.sdp })
  })

  socket.on('call:answer', (payload: { to: string; sdp: any }) => {
    io.to(payload.to).emit('call:answer', { from: socket.id, sdp: payload.sdp })
  })

  socket.on('call:ice-candidate', (payload: { to: string; candidate: any }) => {
    io.to(payload.to).emit('call:ice-candidate', { from: socket.id, candidate: payload.candidate })
  })

  // ─── Presence management ─────────────────────────────────────────────────
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

  // ─── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    removeSocket(userId, socket.id)
    console.log(`[disconnect] ${username} (${userId})`)
  })

  socket.on('error', (err: any) => {
    console.error(`[socket error] ${userId}:`, err)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[SNS Realtime] listening on port ${PORT}`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
process.on('SIGINT', () => httpServer.close(() => process.exit(0)))
