/**
 * Music Room State — server-authoritative state machine for sync play.
 *
 * The server holds the canonical playback state for each room. Clients
 * report their position; the server calculates drift and sends corrections.
 *
 * Position is derived, not polled:
 *   expectedPos = positionSec + (serverNow - positionAnchor) / 1000
 *
 * The server never "plays" anything — clients seek their own audio
 * elements to the derived position.
 */

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
  members: Set<string>  // userIds
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

// Use globalThis so the map survives hot-reloads in dev mode
const globalForRooms = globalThis as unknown as { __adoo_music_rooms?: Map<string, RoomState> }
export const rooms: Map<string, RoomState> = globalForRooms.__adoo_music_rooms || new Map()
globalForRooms.__adoo_music_rooms = rooms

/**
 * Get or create a room's state.
 */
export function getRoom(roomId: string): RoomState | null {
  return rooms.get(roomId) || null
}

/**
 * Create a new room with the given host.
 */
export function createRoom(roomId: string, hostUserId: string): RoomState {
  const room: RoomState = {
    roomId,
    hostUserId,
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
 */
export function updatePlayback(
  roomId: string,
  state: 'playing' | 'paused' | 'stopped',
  positionSec?: number,
): RoomState | null {
  const room = rooms.get(roomId)
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

  return room
}

/**
 * Change the current track. Sets state to 'buffering' until all members
 * send 'ready'.
 */
export function changeTrack(
  roomId: string,
  videoId: string,
  trackInfo: QueueItem,
): RoomState | null {
  const room = rooms.get(roomId)
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
  room.state = 'paused' // will be set to 'playing' when all members are ready
  room.readyMembers.clear()

  return room
}

/**
 * Add a track to the queue.
 */
export function addToQueue(roomId: string, item: QueueItem): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  room.queue.push(item)
  return room
}

/**
 * Remove a track from the queue by videoId.
 */
export function removeFromQueue(roomId: string, videoId: string): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  room.queue = room.queue.filter((q) => q.videoId !== videoId)
  return room
}

/**
 * Pop the next track from the queue.
 */
export function popNextFromQueue(roomId: string): QueueItem | null {
  const room = rooms.get(roomId)
  if (!room || room.queue.length === 0) return null
  return room.queue.shift() || null
}

/**
 * Mark a member as ready (audio loaded). When all members are ready,
 * the room can start playing.
 */
export function markMemberReady(roomId: string, userId: string): { allReady: boolean; room: RoomState | null } {
  const room = rooms.get(roomId)
  if (!room) return { allReady: false, room: null }
  room.readyMembers.add(userId)
  const allReady = room.readyMembers.size >= room.members.size
  return { allReady, room }
}

/**
 * Add a member to the room.
 */
export function addMember(roomId: string, userId: string): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  room.members.add(userId)
  return room
}

/**
 * Remove a member from the room. Returns the new host if the old host left.
 */
export function removeMember(roomId: string, userId: string): { newHost: string | null; room: RoomState | null } {
  const room = rooms.get(roomId)
  if (!room) return { newHost: null, room: null }

  room.members.delete(userId)
  room.readyMembers.delete(userId)

  // If the host left, promote the longest-joined member
  // (first in the members Set, which preserves insertion order)
  let newHost: string | null = null
  if (room.hostUserId === userId && room.members.size > 0) {
    newHost = room.members.values().next().value || null
    if (newHost) {
      room.hostUserId = newHost
    }
  }

  // If room is empty, clean it up after 30s (grace period for reconnection)
  if (room.members.size === 0) {
    setTimeout(() => {
      const r = rooms.get(roomId)
      if (r && r.members.size === 0) {
        rooms.delete(roomId)
      }
    }, 30_000)
  }

  return { newHost, room }
}

/**
 * Transfer host to a specific user.
 */
export function transferHost(roomId: string, newHostUserId: string): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  if (!room.members.has(newHostUserId)) return null
  room.hostUserId = newHostUserId
  return room
}

/**
 * Get the full state snapshot for late joiners.
 */
export function getStateSnapshot(roomId: string): RoomState | null {
  const room = rooms.get(roomId)
  if (!room) return null
  // Return a copy with the derived position
  return {
    ...room,
    positionSec: getExpectedPosition(room),
    positionAnchor: Date.now(),
    members: new Set(room.members),
    readyMembers: new Set(room.readyMembers),
  }
}

/**
 * Check if a user is the host of a room.
 */
export function isHost(roomId: string, userId: string): boolean {
  const room = rooms.get(roomId)
  return room?.hostUserId === userId
}
