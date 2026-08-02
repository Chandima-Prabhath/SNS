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
import {
  getRoom, createRoom, addMember, removeMember, updatePlayback, changeTrack,
  addToQueue, removeFromQueue, popNextFromQueue, markMemberReady, transferHost,
  getStateSnapshot, getExpectedPosition, isHost,
} from './music-room-state'
import { rooms } from './music-room-state'
import jwt from 'next-auth/jwt'
import type { NextApiRequest } from 'next'
import { db } from '@/lib/db'

const SOCKET_PATH = '/api/socket'

interface AuthenticatedSocket {
  userId?: string
  username?: string
}

// in-memory presence map (userId → { status, socketIds[], username })
// Use globalThis to share across Next.js module contexts — same fix as ioRef.
// Without this, API routes (which load a different module instance) see an
// empty presence map, so sendMusicCommand() can't find the target user's
// sockets and silently drops the command.
const globalForPresence = globalThis as unknown as {
  __adoo_presence?: Map<string, { status: string; socketIds: Set<string>; username: string }>
}
const presence: Map<string, { status: string; socketIds: Set<string>; username: string }> =
  globalForPresence.__adoo_presence || new Map()
globalForPresence.__adoo_presence = presence

// Use globalThis to share the io instance across Next.js module contexts.
const globalForIo = globalThis as unknown as { __adoo_io?: IOServer | null }

export function getIO(): IOServer | null {
  return globalForIo.__adoo_io || null
}

/**
 * Send a music bot command to a specific user's sockets via the presence map.
 * Used by the bot framework's controlMusic helper — the server-side bot code
 * calls this to tell the user's client to play/pause/skip/stop music.
 *
 * This is the correct path for server→client music control. The old approach
 * (io.emit to ALL sockets) sent the wrong payload shape and broadcast to
 * everyone instead of just the target user.
 */
export function sendMusicCommand(
  targetUserId: string,
  command: { action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'; query?: string }
): void {
  const io = getIO()
  if (!io) {
    
    return
  }
  const target = presence.get(targetUserId)
  if (!target) {
    
    // Fallback: broadcast to all sockets. Not ideal for production but
    // ensures the command reaches the user even if presence tracking is off.
    io.emit('music:bot-command', command)
    return
  }
  
  for (const sid of target.socketIds) {
    io.to(sid).emit('music:bot-command', command)
  }
}

/** Broadcast the current room state to all members */
function broadcastRoomState(io: IOServer, roomId: string) {
  const room = getRoom(roomId)
  if (!room) return
  io.to(`music:${roomId}`).emit('music:state', {
    roomId: room.roomId, hostUserId: room.hostUserId, state: room.state,
    currentVideoId: room.currentVideoId, currentTrackInfo: room.currentTrackInfo,
    positionSec: getExpectedPosition(room), positionAnchor: room.positionAnchor,
    queue: room.queue, members: Array.from(room.members),
  })
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
        console.error('[realtime auth] NEXTAUTH_SECRET is not set in environment!')
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

      
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection lifecycle
  // ─────────────────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const auth = socket as unknown as AuthenticatedSocket & { userId: string; username: string }
    const { userId, username } = auth
    

    setPresence(userId, username, 'online', socket.id)

    // ─── Chat channel subscriptions ──────────────────────────────────────
    socket.on('channel:join', async (channelId: string) => {
      // Verify membership before joining the socket room (C8 fix)
      const membership = await db.channelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
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

    // ─── Music bot control ─────────────────────────────────────────────
    // Bots emit this to control a user's music player. The server forwards
    // the command to the target user's sockets via the presence map.
    socket.on('music:bot-command', (payload: {
      targetUserId: string
      command: {
        action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
        query?: string
      }
    }) => {
      const target = presence.get(payload.targetUserId)
      if (!target) return
      for (const sid of target.socketIds) {
        io.to(sid).emit('music:bot-command', payload.command)
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

    // NOTE: The call:ring handler below used to register a SECOND
    // 'disconnect' listener per ring (memory leak: N rings → N listeners,
    // all firing on disconnect). We now track retry intervals in a per-socket
    // Set and clear them all from the single disconnect handler at the bottom.
    // ── Per-socket cleanup registry (cleared in the single disconnect handler) ──
    const socketCleanups: Array<() => void> = []

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
        }
      }, 5000)

      // Register interval cleanup for this socket — fires from the single
      // disconnect handler below. Prevents the per-ring listener leak.
      socketCleanups.push(() => clearInterval(retryInterval))
    })

    socket.on('call:accept', (payload: { callId: string; byUserId: string }) => {
      // Notify all of caller's sockets that the call was accepted
      const callerSockets = presence.get(payload.byUserId)
      if (callerSockets) {
        for (const sid of callerSockets.socketIds) {
          io.to(sid).emit('call:accept', { callId: payload.callId, byUserId: userId })
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

    // ─── Music room sync (server-authoritative) ─────────────────────────
    // The server holds canonical playback state. Clients send commands
    // (play, pause, seek, next, queue:add), the server updates state and
    // broadcasts to all members. See src/lib/music-room-state.ts.

    socket.on('music:join', (roomId: string) => {
      socket.join(`music:${roomId}`)
      const room = getRoom(roomId) || createRoom(roomId, userId)
      addMember(roomId, userId)
      // Send full state snapshot to the new member (late joiner sync)
      const snapshot = getStateSnapshot(roomId)
      if (snapshot) {
        io.to(socket.id).emit('music:state', {
          roomId: snapshot.roomId, hostUserId: snapshot.hostUserId,
          state: snapshot.state, currentVideoId: snapshot.currentVideoId,
          currentTrackInfo: snapshot.currentTrackInfo,
          positionSec: snapshot.positionSec, positionAnchor: snapshot.positionAnchor,
          queue: snapshot.queue, members: Array.from(snapshot.members),
        })
      }
      socket.to(`music:${roomId}`).emit('music:member-joined', { roomId, userId, username })
    })

    socket.on('music:leave', (roomId: string) => {
      socket.leave(`music:${roomId}`)
      const { newHost } = removeMember(roomId, userId)
      if (newHost) io.to(`music:${roomId}`).emit('music:host-changed', { roomId, newHostUserId: newHost })
      socket.to(`music:${roomId}`).emit('music:member-left', { roomId, userId })
    })

    socket.on('music:play', (payload: { roomId: string; videoId?: string; trackInfo?: any }) => {
      if (!isHost(payload.roomId, userId)) return
      if (payload.videoId) {
        // New track: changeTrack resets position to 0 and sets state='paused'
        // (waiting for ready handshake). updatePlayback(playing, 0) is then
        // called by the ready handler when all members have buffered.
        changeTrack(payload.roomId, payload.videoId, {
          videoId: payload.videoId, title: payload.trackInfo?.title || 'Unknown',
          artist: payload.trackInfo?.artist || 'Unknown', thumbnail: payload.trackInfo?.thumbnail || null,
          durationSeconds: payload.trackInfo?.durationSeconds || null, addedByUserId: userId, addedAt: Date.now(),
        })
        broadcastRoomState(io, payload.roomId)
        // Safety net: if no member sends 'ready' within 8s (network error,
        // abandoned tab, broken audio element), force-play anyway.
        setTimeout(() => {
          const r = getRoom(payload.roomId)
          if (r && r.state === 'paused' && r.currentVideoId === payload.videoId) {
            updatePlayback(payload.roomId, 'playing', 0)
            broadcastRoomState(io, payload.roomId)
          }
        }, 8_000)
      } else {
        // Resume: keep current position. updatePlayback with no positionSec
        // arg derives it from the previous anchor + elapsed time.
        updatePlayback(payload.roomId, 'playing')
        broadcastRoomState(io, payload.roomId)
      }
    })

    socket.on('music:pause', (roomId: string) => {
      if (!isHost(roomId, userId)) return
      updatePlayback(roomId, 'paused')
      broadcastRoomState(io, roomId)
    })

    socket.on('music:seek', (payload: { roomId: string; position: number }) => {
      if (!isHost(payload.roomId, userId)) return
      const room = getRoom(payload.roomId)
      updatePlayback(payload.roomId, room?.state === 'playing' ? 'playing' : 'paused', payload.position)
      broadcastRoomState(io, payload.roomId)
    })

    socket.on('music:next', (roomId: string) => {
      if (!isHost(roomId, userId)) return
      const next = popNextFromQueue(roomId)
      if (next) changeTrack(roomId, next.videoId, next)
      else updatePlayback(roomId, 'stopped')
      broadcastRoomState(io, roomId)
    })

    socket.on('music:queue:add', (payload: { roomId: string; track: any }) => {
      addToQueue(payload.roomId, {
        videoId: payload.track.videoId, title: payload.track.title || 'Unknown',
        artist: payload.track.artist || 'Unknown', thumbnail: payload.track.thumbnail || null,
        durationSeconds: payload.track.durationSeconds || null, addedByUserId: userId, addedAt: Date.now(),
      })
      const room = getRoom(payload.roomId)
      if (room) io.to(`music:${payload.roomId}`).emit('music:queue:update', { roomId: payload.roomId, queue: room.queue })
    })

    socket.on('music:queue:remove', (payload: { roomId: string; videoId: string }) => {
      removeFromQueue(payload.roomId, payload.videoId)
      const room = getRoom(payload.roomId)
      if (room) io.to(`music:${payload.roomId}`).emit('music:queue:update', { roomId: payload.roomId, queue: room.queue })
    })

    socket.on('music:ready', (roomId: string) => {
      const { allReady, room } = markMemberReady(roomId, userId)
      // Start playback when EITHER all members are ready OR the host is ready
      // (host-ready is sufficient — others will catch up via drift correction).
      const hostIsReady = room?.readyMembers.has(room.hostUserId) === true
      if (room && room.state === 'paused' && (allReady || hostIsReady)) {
        updatePlayback(roomId, 'playing', 0)
        broadcastRoomState(io, roomId)
      }
    })

    socket.on('music:transfer-host', (payload: { roomId: string; newHostUserId: string }) => {
      if (!isHost(payload.roomId, userId)) return
      transferHost(payload.roomId, payload.newHostUserId)
      io.to(`music:${payload.roomId}`).emit('music:host-changed', { roomId: payload.roomId, newHostUserId: payload.newHostUserId })
    })

    socket.on('music:position-report', (payload: { roomId: string; position: number }) => {
      const room = getRoom(payload.roomId)
      if (!room || room.state !== 'playing') return
      const expected = getExpectedPosition(room)
      if (Math.abs(payload.position - expected) > 1.5) {
        io.to(socket.id).emit('music:state', {
          roomId: room.roomId, hostUserId: room.hostUserId, state: room.state,
          currentVideoId: room.currentVideoId, currentTrackInfo: room.currentTrackInfo,
          positionSec: expected, positionAnchor: room.positionAnchor,
          queue: room.queue, members: Array.from(room.members),
        })
      }
    })


    // ── Single disconnect handler — runs ALL cleanup for this socket ────
    // Previously we had two disconnect handlers (one for calls, one added per
    // call:ring event) — both fired on disconnect, the ring one accumulated.
    // Now we run all cleanup here, including the registered socketCleanups.
    socket.on('disconnect', () => {
      // 1. Run registered cleanups (call:ring retry intervals, etc.)
      for (const cleanup of socketCleanups) {
        try { cleanup() } catch {}
      }
      socketCleanups.length = 0

      // 2. Find all calls this socket was in and check if they should end
      for (const room of socket.rooms) {
        if (room.startsWith('call:')) {
          const callId = room.substring(5)
          socket.to(room).emit('call:peer-left', { peerId: socket.id, userId })
          checkCallEnd(callId)
        }
      }

      // 3. Remove from presence (only if no other socket for this user)
      removeSocket(userId, socket.id)

      // 4. Remove from all music rooms + handle host migration.
      // Multi-tab fix: only remove the user from the room if they have no
      // other connected sockets. Otherwise the still-open tab would lose
      // its membership and the room could be GC'd out from under it.
      const userPresence = presence.get(userId)
      const userHasOtherSockets = userPresence && userPresence.socketIds.size > 0
      if (!userHasOtherSockets) {
        for (const [roomId, room] of rooms.entries()) {
          if (room.members.has(userId)) {
            const { newHost } = removeMember(roomId, userId)
            if (newHost) {
              io.to(`music:${roomId}`).emit('music:host-changed', { roomId, newHostUserId: newHost })
            }
            socket.to(`music:${roomId}`).emit('music:member-left', { roomId, userId })
          }
        }
      }
    })

    socket.on('error', (err: any) => {
      console.error(`[realtime] socket error ${userId}:`, err)
    })
  })

  
  return io
}
