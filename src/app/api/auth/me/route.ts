import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ user: null }, { status: 401 })
  const dbUser = await db.user.findUnique({
    where: { id: session.user.id },
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
      lastSeenVisible: true,
      readReceiptsEnabled: true,
      typingIndicatorsEnabled: true,
      notificationPrefs: true,
    },
  })
  if (!dbUser) return NextResponse.json({ user: null }, { status: 401 })

  // Parse notificationPrefs JSON string → object for the client
  const user: any = { ...dbUser }
  if (dbUser.notificationPrefs) {
    try { user.notificationPrefs = JSON.parse(dbUser.notificationPrefs) } catch { user.notificationPrefs = null }
  }
  return NextResponse.json({ user })
}
