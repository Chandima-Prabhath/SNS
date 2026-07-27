import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * POST /api/push/subscribe
 * Stores the user's push subscription for later use.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const subscription = await req.json()

  // Store as a user setting (JSON string)
  await db.userSetting.upsert({
    where: { userId_key: { userId, key: 'pushSubscription' } },
    create: { userId, key: 'pushSubscription', value: JSON.stringify(subscription) },
    update: { value: JSON.stringify(subscription) },
  })

  return NextResponse.json({ ok: true })
}
