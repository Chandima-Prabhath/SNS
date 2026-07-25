import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ user: null }, { status: 401 })
  const dbUser = await db.user.findUnique({
    where: { id: (session.user as any).id },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      role: true,
      status: true,
      customStatus: true,
    },
  })
  return NextResponse.json({ user: dbUser })
}
