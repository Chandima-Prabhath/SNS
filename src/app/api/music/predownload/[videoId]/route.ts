import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { existsSync, statSync } from 'fs'
import path from 'path'

const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'music')

/**
 * POST /api/music/predownload/[videoId]
 *
 * Pre-downloads a track to the server cache so it's ready to play instantly
 * when the user gets to it in the queue. Returns 200 if already cached or
 * successfully downloaded, or the error if the download fails.
 *
 * This is fire-and-forget from the client's perspective — the queue
 * pre-downloader calls this for upcoming tracks while the current track
 * is playing.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { videoId } = await params
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 })
  }

  const filePath = path.join(CACHE_DIR, `${videoId}.mp3`)

  // Already cached — return immediately
  if (existsSync(filePath) && statSync(filePath).size > 1000) {
    return NextResponse.json({ cached: true, videoId })
  }

  // Not cached — trigger the download by calling the stream endpoint
  // internally (but don't stream the response, just let it download)
  try {
    const res = await fetch(`http://localhost:${process.env.PORT || 3090}/api/music/stream/${videoId}`, {
      method: 'GET',
      headers: { range: 'bytes=0-0' }, // Just request 1 byte to trigger the download
    })

    if (res.ok || res.status === 206) {
      return NextResponse.json({ cached: true, videoId })
    }

    return NextResponse.json({ cached: false, error: 'Download failed' }, { status: 502 })
  } catch (e: any) {
    return NextResponse.json({ cached: false, error: e?.message }, { status: 502 })
  }
}
