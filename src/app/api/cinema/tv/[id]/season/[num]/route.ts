import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getTvSeason } from '@/lib/tmdb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; num: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id, num } = await params
  const tvId = parseInt(id, 10)
  const seasonNum = parseInt(num, 10)
  if (isNaN(tvId) || isNaN(seasonNum)) return NextResponse.json({ error: 'invalid params' }, { status: 400 })

  try {
    const season = await getTvSeason(tvId, seasonNum)
    return NextResponse.json({ season })
  } catch (e: any) {
    console.error('[cinema/tv/season] error:', e?.message)
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
