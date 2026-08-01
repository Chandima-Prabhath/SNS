import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/music/playlists — list the current user's playlists (with songs).
 * POST /api/music/playlists — create a playlist. Body: { name }
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const playlists = await db.playlist.findMany({
    where: { userId },
    include: {
      songs: { orderBy: { order: 'asc' } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({ playlists })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json()
  const { name } = body
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  const playlist = await db.playlist.create({
    data: { userId, name: name.trim() },
  })

  return NextResponse.json({ playlist })
}
