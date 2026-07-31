import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/music/playlists/[playlistId]/songs
 *   Add a song to a playlist. Body: { videoId, title, artist, thumbnail?, durationSeconds? }
 *
 * DELETE /api/music/playlists/[playlistId]/songs?videoId=xxx
 *   Remove a song from a playlist.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { playlistId } = await params

  // Verify ownership
  const playlist = await db.playlist.findUnique({ where: { id: playlistId } })
  if (!playlist || playlist.userId !== userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json()
  const { videoId, title, artist, thumbnail, durationSeconds } = body
  if (!videoId || !title || !artist) {
    return NextResponse.json({ error: 'videoId, title, artist required' }, { status: 400 })
  }

  // Get the current max order to append at the end
  const maxOrderRow = await db.playlistSong.findFirst({
    where: { playlistId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })
  const nextOrder = (maxOrderRow?.order || 0) + 1

  // Upsert — if already in playlist, just update metadata
  const song = await db.playlistSong.upsert({
    where: { playlistId_videoId: { playlistId, videoId } },
    create: { playlistId, videoId, title, artist, thumbnail, durationSeconds, order: nextOrder },
    update: { title, artist, thumbnail, durationSeconds },
  })

  // Touch the playlist's updatedAt so it sorts to the top
  await db.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } })

  return NextResponse.json({ song })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { playlistId } = await params

  // Verify ownership
  const playlist = await db.playlist.findUnique({ where: { id: playlistId } })
  if (!playlist || playlist.userId !== userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const videoId = url.searchParams.get('videoId')
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  await db.playlistSong.deleteMany({
    where: { playlistId, videoId },
  })

  return NextResponse.json({ success: true })
}
