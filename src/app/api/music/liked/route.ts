import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/music/liked — list the current user's liked songs.
 * POST /api/music/liked — like a song. Body: { videoId, title, artist, thumbnail?, durationSeconds? }
 * DELETE /api/music/liked?videoId=xxx — unlike a song.
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const liked = await db.likedSong.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ songs: liked })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json()
  const { videoId, title, artist, thumbnail, durationSeconds } = body
  if (!videoId || !title || !artist) {
    return NextResponse.json({ error: 'videoId, title, artist required' }, { status: 400 })
  }

  // Upsert — if already liked, do nothing (idempotent)
  const liked = await db.likedSong.upsert({
    where: { userId_videoId: { userId, videoId } },
    create: { userId, videoId, title, artist, thumbnail, durationSeconds },
    update: { title, artist, thumbnail, durationSeconds }, // refresh metadata
  })

  return NextResponse.json({ song: liked })
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const url = new URL(req.url)
  const videoId = url.searchParams.get('videoId')
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  await db.likedSong.deleteMany({
    where: { userId, videoId },
  })

  return NextResponse.json({ success: true })
}
