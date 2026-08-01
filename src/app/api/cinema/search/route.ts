import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { searchMulti } from '@/lib/tmdb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const query = url.searchParams.get('q') || ''
  const page = parseInt(url.searchParams.get('page') || '1', 10)

  if (!query.trim()) return NextResponse.json({ results: [] })

  try {
    const results = await searchMulti(query, page)
    return NextResponse.json({ results })
  } catch (e: any) {
    console.error('[cinema/search] error:', e?.message)
    return NextResponse.json({ results: [], error: 'search failed' })
  }
}
