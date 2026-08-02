import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Known push service hosts. Any other host must be explicitly allow-listed
// via the ALLOWED_PUSH_HOSTS env var (comma-separated) — e.g. for a
// self-hosted Mastodon push server.
const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.fcm.googleapis.com',
  '.push.apple.com',
  'updates.push.services.mozilla.com',
]

function isAllowedPushHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  // Exact match
  if (ALLOWED_PUSH_HOST_SUFFIXES.includes(lower)) return true
  // Suffix match for subdomains (e.g. fcm.googleapis.com, fcmtoken.push.apple.com)
  for (const suffix of ALLOWED_PUSH_HOST_SUFFIXES) {
    if (suffix.startsWith('.') ? lower.endsWith(suffix) : lower === suffix) {
      return true
    }
  }
  // Operator-configured allow-list (e.g. self-hosted Mastodon push server)
  const extraHosts = (process.env.ALLOWED_PUSH_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return extraHosts.includes(lower)
}

/**
 * POST /api/push/subscribe
 * Stores a push subscription for the current device.
 * Supports multiple devices per user — each device gets its own row
 * in PushSubscription (keyed by endpoint URL).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const subscription = await req.json()
  if (!subscription?.endpoint || typeof subscription.endpoint !== 'string') {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  }

  // SSRF protection: validate the endpoint is an HTTPS URL pointing at a
  // known push service. Without this, an attacker could store an arbitrary
  // URL as their endpoint and trick the server into sending push payloads
  // (with our VAPID auth) to internal services.
  let endpointUrl: URL
  try {
    endpointUrl = new URL(subscription.endpoint)
  } catch {
    return NextResponse.json({ error: 'invalid endpoint' }, { status: 400 })
  }
  if (endpointUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'endpoint must use https' }, { status: 400 })
  }
  if (!isAllowedPushHost(endpointUrl.hostname)) {
    return NextResponse.json({ error: 'endpoint host not allowed' }, { status: 400 })
  }

  const userAgent = req.headers.get('user-agent') || 'unknown'

  // Upsert by (userId, endpoint) — if the same browser re-subscribes
  // (e.g. after clearing cookies), we update the keys instead of duplicating
  await db.pushSubscription.upsert({
    where: { userId_endpoint: { userId, endpoint: subscription.endpoint } },
    create: {
      userId,
      endpoint: subscription.endpoint,
      keys: JSON.stringify(subscription.keys || {}),
      userAgent,
    },
    update: {
      keys: JSON.stringify(subscription.keys || {}),
      userAgent,
    },
  })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/push/subscribe
 * Removes a push subscription (e.g. when user signs out or unsubscribes).
 * Body: { endpoint } or no body to remove all for this user.
 */
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  try {
    const body = await req.json().catch(() => ({}))
    if (body?.endpoint) {
      await db.pushSubscription.deleteMany({
        where: { userId, endpoint: body.endpoint },
      })
    } else {
      await db.pushSubscription.deleteMany({ where: { userId } })
    }
  } catch {
    // Body might be empty — delete all
    await db.pushSubscription.deleteMany({ where: { userId } })
  }

  return NextResponse.json({ ok: true })
}
