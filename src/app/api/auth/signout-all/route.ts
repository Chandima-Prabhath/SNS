import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * POST /api/auth/signout-all — Sign out from ALL devices.
 *
 * Increments the user's tokenVersion, which invalidates all existing JWTs.
 * The jwt callback in auth.ts checks tokenVersion on every token refresh —
 * if it doesn't match, the token is invalidated and the user is forced to
 * re-authenticate.
 *
 * Also clears the UserSession table (all device records).
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  await db.$transaction([
    db.userSession.deleteMany({ where: { userId } }),
    db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ])

  return NextResponse.json({ ok: true, message: 'Signed out from all devices' })
}
