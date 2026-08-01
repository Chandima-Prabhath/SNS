import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/music/playlists/[playlistId] — delete a playlist (and all its songs).
 */

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ playlistId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { playlistId } = await params

  // Verify ownership
  const playlist = await db.playlist.findUnique({ where: { id: playlistId } })
  if (!playlist || playlist.userId !== userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  await db.playlist.delete({ where: { id: playlistId } })
  return NextResponse.json({ success: true })
}
