import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Update own profile
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { id } = await params
  if (id !== 'me' && id !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const allowed = ['displayName', 'bio', 'avatarUrl', 'customStatus', 'status', 'lastSeenVisible', 'readReceiptsEnabled', 'typingIndicatorsEnabled']
  const data: any = {}
  for (const k of allowed) {
    if (k in body) data[k] = body[k]
  }

  const updated = await db.user.update({
    where: { id: userId },
    data,
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
    },
  })
  return NextResponse.json({ user: updated })
}
