import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * POST /api/push/subscribe
 * Stores a push subscription for the current device.
 * Supports multiple devices per user — each device gets its own row
 * in PushSubscription (keyed by endpoint URL).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const subscription = await req.json()
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
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
  const userId = (session.user as any).id

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
