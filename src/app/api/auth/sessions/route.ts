import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/auth/sessions — list active sessions (devices) for the current user.
 * Returns each session's ID, userAgent, IP, createdAt, lastActiveAt.
 *
 * DELETE /api/auth/sessions?id=<sessionId> — revoke a specific session.
 * DELETE /api/auth/sessions (no id) — revoke ALL sessions (sign out everywhere).
 *   This increments tokenVersion, invalidating all JWTs.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const sessions = await db.userSession.findMany({
    where: { userId },
    orderBy: { lastActiveAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastActiveAt: true },
  })

  return NextResponse.json({ sessions })
}

// Revoke a specific session by ID, or all sessions if no ID provided
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('id')

  if (sessionId) {
    // Revoke a single session
    await db.userSession.deleteMany({
      where: { id: sessionId, userId }, // userId ensures user can only revoke their own
    })
    return NextResponse.json({ ok: true, revoked: sessionId })
  }

  // No session ID — revoke ALL sessions (sign out everywhere)
  // Increment tokenVersion so all JWTs are invalidated
  await db.$transaction([
    db.userSession.deleteMany({ where: { userId } }),
    db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ])

  return NextResponse.json({ ok: true, revoked: 'all' })
}
