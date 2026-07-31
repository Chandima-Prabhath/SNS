import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getMovieDetails } from '@/lib/tmdb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const movieId = parseInt(id, 10)
  if (isNaN(movieId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  try {
    const details = await getMovieDetails(movieId)
    return NextResponse.json({ movie: details })
  } catch (e: any) {
    console.error('[cinema/movie] error:', e?.message)
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
