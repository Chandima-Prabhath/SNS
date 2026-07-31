import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getGenres, discoverByGenre } from '@/lib/tmdb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const type = (url.searchParams.get('type') as 'movie' | 'tv') || 'movie'
  const genreId = url.searchParams.get('genreId')

  try {
    if (genreId) {
      const results = await discoverByGenre(type, parseInt(genreId, 10))
      return NextResponse.json({ results })
    }
    const genres = await getGenres(type)
    return NextResponse.json({ genres })
  } catch (e: any) {
    console.error('[cinema/genres] error:', e?.message)
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
