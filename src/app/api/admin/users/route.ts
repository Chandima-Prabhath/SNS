import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  if ((session.user as any).role !== 'admin' && (session.user as any).role !== 'owner') return null
  return session
}

export async function GET() {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      status: true,
      createdAt: true,
      lastSeenAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ users })
}

// Update user role
export async function PATCH(req: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { userId, role } = await req.json()
  if (!['member', 'admin', 'owner'].includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  }
  const updated = await db.user.update({
    where: { id: userId },
    data: { role },
  })
  return NextResponse.json({ user: updated })
}
