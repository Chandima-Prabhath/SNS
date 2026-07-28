import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/music/rooms/[id] — Get a music room with its current state.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const room = await db.musicRoom.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  })

  if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({ room })
}

/**
 * PATCH /api/music/rooms/[id] — Update playback state.
 *
 * Body: { action: 'play' | 'pause' | 'seek' | 'track', videoId?, position?, queue? }
 *
 * The server is the source of truth for playback state. Clients send
 * their actions here, and the server broadcasts the new state to all
 * room members via Socket.io.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const room = await db.musicRoom.findUnique({ where: { id } })
  if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Only the host can control playback
  if (room.hostId !== userId) {
    return NextResponse.json({ error: 'only the host can control playback' }, { status: 403 })
  }

  const body = await req.json()
  const { action, videoId, position, queue } = body

  const data: any = { lastSyncAt: new Date() }

  switch (action) {
    case 'play':
      data.currentState = 'playing'
      if (typeof position === 'number') data.currentPosition = position
      break
    case 'pause':
      data.currentState = 'paused'
      if (typeof position === 'number') data.currentPosition = position
      break
    case 'seek':
      if (typeof position === 'number') data.currentPosition = position
      break
    case 'track':
      if (videoId) {
        data.currentVideoId = videoId
        data.currentPosition = 0
        data.currentState = 'playing'
      }
      break
    case 'queue':
      if (Array.isArray(queue)) {
        data.queue = JSON.stringify(queue)
      }
      break
  }

  const updated = await db.musicRoom.update({
    where: { id },
    data,
    include: {
      host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  })

  return NextResponse.json({ room: updated })
}

/**
 * DELETE /api/music/rooms/[id] — Delete a music room (host only).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params

  const room = await db.musicRoom.findUnique({ where: { id } })
  if (!room) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (room.hostId !== userId) {
    return NextResponse.json({ error: 'only the host can delete the room' }, { status: 403 })
  }

  await db.musicRoom.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
