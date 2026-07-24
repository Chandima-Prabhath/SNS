import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getIceServers, isTurnEnabled } from '@/lib/turn'
import { db } from '@/lib/db'

/**
 * Returns WebRTC ICE servers for the current user.
 *
 * Always includes Google's free STUN.
 * If Cloudflare TURN credentials are configured in .env, also returns
 * time-limited TURN credentials (signed server-side).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const iceServers = getIceServers()
  return NextResponse.json({
    iceServers,
    turnEnabled: isTurnEnabled(),
    stunUrl: process.env.WEBRTC_STUN_URL || 'stun:stun.l.google.com:19302',
  })
}
