import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/music/history — list play history for the current user.
 * Returns the 50 most recently played tracks, newest first.
 *
 * POST /api/music/history — add a track to play history.
 * Body: { videoId, title, artist, thumbnail?, durationSeconds? }
 * Called automatically when a new track starts playing.
 * Deduplicates: if the same videoId is already in history, it's moved to the top
 * (playedAt updated) instead of creating a duplicate.
 *
 * DELETE /api/music/history — clear all play history.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const history = await db.playHistory.findMany({
    where: { userId },
    orderBy: { playedAt: 'desc' },
    take: 50,
    select: {
      videoId: true,
      title: true,
      artist: true,
      thumbnail: true,
      durationSeconds: true,
      playedAt: true,
    },
  })

  return NextResponse.json({ songs: history })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json()
  const { videoId, title, artist, thumbnail, durationSeconds } = body

  if (!videoId || !title || !artist) {
    return NextResponse.json({ error: 'videoId, title, artist required' }, { status: 400 })
  }

  // Delete existing entry for this videoId (so it moves to top on re-insert)
  await db.playHistory.deleteMany({
    where: { userId, videoId },
  })

  // Insert new entry at the top
  await db.playHistory.create({
    data: {
      userId,
      videoId,
      title,
      artist,
      thumbnail: thumbnail || null,
      durationSeconds: durationSeconds || null,
    },
  })

  // Trim to 50 entries (delete oldest beyond 50)
  const count = await db.playHistory.count({ where: { userId } })
  if (count > 50) {
    const oldest = await db.playHistory.findMany({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      skip: 50,
      select: { id: true },
    })
    if (oldest.length > 0) {
      await db.playHistory.deleteMany({
        where: { id: { in: oldest.map((h) => h.id) } },
      })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  await db.playHistory.deleteMany({ where: { userId } })
  return NextResponse.json({ ok: true })
}
