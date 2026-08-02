/**
 * Music Room State — DB-backed state machine for sync play.
 *
 * FOOLPROOF DESIGN:
 *   All room state is persisted to the MusicRoom table in the DB. An
 *   in-memory cache (the `rooms` Map) is used for fast access during
 *   position reports and drift correction, but the DB is the source of
 *   truth. If the cache is empty (server restart, module re-instantiation),
 *   the server reads from the DB.
 *
 *   This fixes the core bug where late-joiners got an empty queue / no
 *   current track because the in-memory state was lost.
 *
 * Position is derived, not polled:
 *   expectedPos = positionSec + (now - positionAnchor) / 1000
 *
 * The server never "plays" anything — clients seek their own audio
 * elements to the derived position.
 */

import { db } from '@/lib/db'

export interface RoomState {
  roomId: string
  hostUserId: string
  state: 'playing' | 'paused' | 'stopped'
  currentVideoId: string | null
  currentTrackInfo: {
    title: string
    artist: string
    thumbnail: string | null
    durationSeconds: number | null
  } | null
  positionSec: number  // position when state last changed
  positionAnchor: number  // server timestamp (ms) when positionSec was set
  queue: QueueItem[]
  members: Set<string>  // userIds (in-memory only — DB has MusicRoomMember)
  readyMembers: Set<string>  // userIds that sent 'ready' for current track
  createdAt: number
}

export interface QueueItem {
  videoId: string
  title: string
  artist: string
  thumbnail: string | null
  durationSeconds: number | null
  addedByUserId: string
  addedAt: number
}

// In-memory cache — NOT the source of truth. Survives hot-reloads via
// globalThis. If empty, we read from the DB.
const globalForRooms = globalThis as unknown as { __adoo_music_rooms?: Map<string, RoomState> }
const rooms: Map<string, RoomState> = globalForRooms.__adoo_music_rooms || new Map()
globalForRooms.__adoo_music_rooms = rooms

/**
 * Load a room's state from the DB into the in-memory cache.
 * Called when getRoom() misses the cache.
 */
async function loadRoomFromDB(roomId: string): Promise<RoomState | null> {
  const dbRoom = await db.musicRoom.findUnique({
    where: { id: roomId },
    include: { members: { select: { userId: true } } },
  })
  if (!dbRoom) return null

  let queue: QueueItem[] = []
  try { queue = JSON.parse(dbRoom.queue || '[]') } catch {}

  let currentTrackInfo: RoomState['currentTrackInfo'] = null
  try {
    if (dbRoom.currentTrackInfo) {
      currentTrackInfo = JSON.parse(dbRoom.currentTrackInfo)
    }
  } catch {}

  const members = new Set(dbRoom.members.map((m) => m.userId))

  const room: RoomState = {
    roomId: dbRoom.id,
    hostUserId: dbRoom.hostId,
    state: dbRoom.currentState as RoomState['state'],
    currentVideoId: dbRoom.currentVideoId,
    currentTrackInfo,
    positionSec: dbRoom.currentPosition,
    positionAnchor: dbRoom.positionAnchor.getTime(),
    queue,
    members,
    readyMembers: new Set(),
    createdAt: dbRoom.createdAt.getTime(),
  }
  rooms.set(roomId, room)
  return room
}

/**
 * Persist the in-memory room state to the DB. Called after every state
 * transition (play/pause/track change/queue change). Best-effort — if the
 * DB write fails, the in-memory state is still valid for the current
 * session, but won't survive a restart.
 */
async function persistRoom(roomId: string): Promise<void> {
  const room = rooms.get(roomId)
  if (!room) return
  try {
    await db.musicRoom.update({
      where: { id: roomId },
      data: {
        currentVideoId: room.currentVideoId,
        currentTrackInfo: room.currentTrackInfo ? JSON.stringify(room.currentTrackInfo) : null,
        currentState: room.state,
        currentPosition: room.positionSec,
        positionAnchor: new Date(room.positionAnchor),
        lastSyncAt: new Date(),
        queue: JSON.stringify(room.queue),
      },
    })
  } catch (e) {
    console.error('[music-room-state] persistRoom failed:', e)
  }
}

/**
 * Get a room's state. Reads from in-memory cache first; if missing, loads
 * from DB. Always returns the latest state.
 */
export async function getRoom(roomId: string): Promise<RoomState | null> {
  const cached = rooms.get(roomId)
  if (cached) return cached
  return loadRoomFromDB(roomId)
}

/**
 * Helper: get a room from cache or DB. Returns null if not found.
 * Used by all state-mutating functions to ensure they operate on the
 * latest DB-backed state.
 */
async function getRoomForMutation(roomId: string): Promise<RoomState | null> {
  return getRoom(roomId)
}

/**
 * Create a new room in the DB + cache. Called when a user creates a room
 * via the API (POST /api/music/rooms) or when the first socket joins a
 * room that doesn't exist yet.
 */
export async function createRoom(roomId: string, hostUserId: string): Promise<RoomState> {
  // Check if the room already exists in the DB (e.g. created via API)
  const existing = await db.musicRoom.findUnique({ where: { id: roomId } })
  if (existing) {
    // Room exists in DB but not in cache — load it
    const loaded = await loadRoomFromDB(roomId)
    if (loaded) return loaded
  }

  // Create a new room in the DB
  const dbRoom = await db.musicRoom.create({
    data: {
      id: roomId,
      name: `Room ${roomId.slice(-4)}`,
      hostId: hostUserId,
      members: { create: { userId: hostUserId } },
    },
  })

  const room: RoomState = {
    roomId: dbRoom.id,
    hostUserId: dbRoom.hostId,
    state: 'stopped',
    currentVideoId: null,
    currentTrackInfo: null,
    positionSec: 0,
    positionAnchor: Date.now(),
    queue: [],
    members: new Set([hostUserId]),
    readyMembers: new Set(),
    createdAt: Date.now(),
  }
  rooms.set(roomId, room)
  return room
}

/**
 * Get the expected playback position at the current time.
 * If playing: position = positionSec + (now - anchor) / 1000
 * If paused/stopped: position = positionSec (frozen)
 */
export function getExpectedPosition(room: RoomState): number {
  if (room.state !== 'playing') return room.positionSec
  const elapsed = (Date.now() - room.positionAnchor) / 1000
  return room.positionSec + elapsed
}

/**
 * Update playback state. Resets the position anchor.
 * Persists to DB.
 */
export async function updatePlayback(
  roomId: string,
  state: 'playing' | 'paused' | 'stopped',
  positionSec?: number,
): Promise<RoomState | null> {
  const room = await getRoomForMutation(roomId)
  if (!room) return null

  room.state = state
  room.positionSec = positionSec ?? getExpectedPosition(room)
  room.positionAnchor = Date.now()

  if (state === 'stopped') {
    room.currentVideoId = null
    room.currentTrackInfo = null
    room.positionSec = 0
  }

  // Reset ready members on state change
  if (state === 'playing') {
    room.readyMembers.clear()
  }

  rooms.set(roomId, room)
  await persistRoom(roomId)
  return room
}

/**
 * Change the current track. Sets state to 'paused' until all members
 * send 'ready'.
 * Persists to DB.
 */
export async function changeTrack(
  roomId: string,
  videoId: string,
  trackInfo: QueueItem,
): Promise<RoomState | null> {
  const room = await getRoomForMutation(roomId)
  if (!room) return null

  room.currentVideoId = videoId
  room.currentTrackInfo = {
    title: trackInfo.title,
    artist: trackInfo.artist,
    thumbnail: trackInfo.thumbnail,
    durationSeconds: trackInfo.durationSeconds,
  }
  room.positionSec = 0
  room.positionAnchor = Date.now()
  room.state = 'paused'
  room.readyMembers.clear()

  rooms.set(roomId, room)
  await persistRoom(roomId)
  return room
}

/**
 * Add a track to the queue.
 * Persists to DB.
 */
export async function addToQueue(roomId: string, item: QueueItem): Promise<RoomState | null> {
  const room = await getRoomForMutation(roomId)
  if (!room) return null
  room.queue.push(item)
  rooms.set(roomId, room)
  await persistRoom(roomId)
  return room
}

/**
 * Remove a track from the queue by videoId.
 * Persists to DB.
 */
export async function removeFromQueue(roomId: string, videoId: string): Promise<RoomState | null> {
  const room = await getRoomForMutation(roomId)
  if (!room) return null
  room.queue = room.queue.filter((q) => q.videoId !== videoId)
  rooms.set(roomId, room)
  await persistRoom(roomId)
  return room
}

/**
 * Pop the next track from the queue.
 * Persists to DB (queue changed).
 */
export async function popNextFromQueue(roomId: string): Promise<QueueItem | null> {
  const room = await getRoomForMutation(roomId)
  if (!room || room.queue.length === 0) return null
  const item = room.queue.shift() || null
  rooms.set(roomId, room)
  await persistRoom(roomId)
  return item
}

/**
 * Mark a member as ready (audio loaded). When all members are ready,
 * the room can start playing.
 */
export async function markMemberReady(roomId: string, userId: string): Promise<{ allReady: boolean; room: RoomState | null }> {
  const room = await getRoomForMutation(roomId)
  if (!room) return { allReady: false, room: null }
  room.readyMembers.add(userId)
  const allReady = room.readyMembers.size >= room.members.size
  return { allReady, room }
}

/**
 * Add a member to the room (in-memory + DB).
 */
export async function addMember(roomId: string, userId: string): Promise<RoomState | null> {
  const room = await getRoomForMutation(roomId)
  if (!room) return null
  room.members.add(userId)
  rooms.set(roomId, room)
  // Persist membership to DB
  try {
    await db.musicRoomMember.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: {},
    })
  } catch (e) {
    console.error('[music-room-state] addMember persist failed:', e)
  }
  return room
}

/**
 * Remove a member from the room. Returns the new host if the old host left.
 * Persists membership removal to DB.
 */
export async function removeMember(roomId: string, userId: string): Promise<{ newHost: string | null; room: RoomState | null }> {
  const room = await getRoomForMutation(roomId)
  if (!room) return { newHost: null, room: null }

  room.members.delete(userId)
  room.readyMembers.delete(userId)

  // If the host left, promote the longest-joined member
  let newHost: string | null = null
  if (room.hostUserId === userId && room.members.size > 0) {
    newHost = room.members.values().next().value || null
    if (newHost) {
      room.hostUserId = newHost
      // Persist host change to DB
      try {
        await db.musicRoom.update({
          where: { id: roomId },
          data: { hostId: newHost },
        })
      } catch (e) {
        console.error('[music-room-state] host transfer persist failed:', e)
      }
    }
  }

  // Persist membership removal to DB
  try {
    await db.musicRoomMember.deleteMany({
      where: { roomId, userId },
    })
  } catch (e) {
    console.error('[music-room-state] removeMember persist failed:', e)
  }

  rooms.set(roomId, room)
  return { newHost, room }
}

/**
 * Transfer host to a specific user.
 * Persists to DB.
 */
export async function transferHost(roomId: string, newHostUserId: string): Promise<RoomState | null> {
  const room = await getRoomForMutation(roomId)
  if (!room) return null
  if (!room.members.has(newHostUserId)) return null
  room.hostUserId = newHostUserId
  rooms.set(roomId, room)
  await persistRoom(roomId)
  return room
}

/**
 * Get the full state snapshot for late joiners.
 * Reads from cache (or DB if cache is empty).
 */
export async function getStateSnapshot(roomId: string): Promise<RoomState | null> {
  return getRoom(roomId)
}

/**
 * Check if a user is the host of a room.
 */
export async function isHost(roomId: string, userId: string): Promise<boolean> {
  const room = await getRoom(roomId)
  return room?.hostUserId === userId
}

// ── In-memory-only helpers (no DB) ─────────────────────────────────────────
// These operate on the in-memory cache only. Used by the disconnect handler
// for quick lookups without awaiting DB reads.

export function getCachedRooms(): Map<string, RoomState> {
  return rooms
}
