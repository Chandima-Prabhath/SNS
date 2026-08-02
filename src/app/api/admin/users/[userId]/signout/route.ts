import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * POST /api/admin/users/[userId]/signout
 *
 * Admin force-logout: invalidates ALL of a user's sessions by:
 *   1. Deleting all their UserSession rows (device tracking)
 *   2. Incrementing their tokenVersion (invalidates all JWTs)
 *
 * The user will be forced to re-authenticate on every device the next time
 * they hit the API. Same mechanism as the user's own "sign out everywhere".
 *
 * Admin-only. The caller cannot sign themselves out this way (use the normal
 * sign-out flow) — and owners cannot be signed out by admins (only by other
 * owners, but we don't enforce that here since admin role already implies
 * elevated trust).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (session.user.role !== 'admin' && session.user.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { userId } = await params

  // Don't allow admins to sign out themselves or other admins/owners
  // (only owners can do that — and they should use the user-management UI
  // directly, not this endpoint).
  if (userId === session.user.id) {
    return NextResponse.json({ error: 'use the normal sign-out flow' }, { status: 400 })
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, displayName: true },
  })
  if (!target) return NextResponse.json({ error: 'user not found' }, { status: 404 })

  // Admins cannot sign out other admins or owners (only owners can).
  if (session.user.role === 'admin' && (target.role === 'admin' || target.role === 'owner')) {
    return NextResponse.json({ error: 'insufficient privileges' }, { status: 403 })
  }

  await db.$transaction([
    db.userSession.deleteMany({ where: { userId } }),
    db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ])

  return NextResponse.json({ ok: true, signedOut: target.displayName })
}
