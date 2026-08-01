import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTrending, getPopular, getTopRated, getNowPlaying, getAiringToday } from '@/lib/tmdb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const category = url.searchParams.get('category') || 'trending'

  try {
    let results: any[] = []
    switch (category) {
      case 'trending':
        results = await getTrending('all', 'week')
        break
      case 'trending-movies':
        results = await getTrending('movie', 'week')
        break
      case 'trending-tv':
        results = await getTrending('tv', 'week')
        break
      case 'popular-movies':
        results = await getPopular('movie')
        break
      case 'popular-tv':
        results = await getPopular('tv')
        break
      case 'top-rated-movies':
        results = await getTopRated('movie')
        break
      case 'top-rated-tv':
        results = await getTopRated('tv')
        break
      case 'now-playing':
        results = await getNowPlaying()
        break
      case 'airing-today':
        results = await getAiringToday()
        break
      default:
        results = await getTrending('all', 'week')
    }
    return NextResponse.json({ results })
  } catch (e: any) {
    console.error('[cinema/trending] error:', e?.message)
    return NextResponse.json({ results: [], error: 'fetch failed' })
  }
}
