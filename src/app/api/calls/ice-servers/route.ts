import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getIceServers, getTurnProviderInfo } from '@/lib/turn'

/**
 * Returns WebRTC ICE servers for the current user.
 *
 * Always includes:
 *   - Google STUN
 *   - Metered OpenRelay TURN (free default, public creds)
 *
 * Optionally adds:
 *   - Cloudflare TURN (if CLOUDFLARE_TURN_KEY_ID + SECRET in .env)
 *   - Custom coturn (if CUSTOM_TURN_URL + USER + CRED in .env)
 *
 * Swap providers by editing .env — no code changes needed.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const iceServers = getIceServers()
  const providerInfo = getTurnProviderInfo()

  return NextResponse.json({
    iceServers,
    ...providerInfo,
  })
}
