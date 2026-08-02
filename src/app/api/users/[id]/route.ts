import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { z } from 'zod'

const profileUpdateSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().max(500).optional().nullable(),
  customStatus: z.string().max(100).optional().nullable(),
  status: z.enum(['online', 'idle', 'dnd', 'offline']).optional(),
  lastSeenVisible: z.boolean().optional(),
  readReceiptsEnabled: z.boolean().optional(),
  typingIndicatorsEnabled: z.boolean().optional(),
  notificationPrefs: z.object({
    messages: z.boolean().optional(),
    mentions: z.boolean().optional(),
    calls: z.boolean().optional(),
    stories: z.boolean().optional(),
    sound: z.boolean().optional(),
  }).optional(),
})

/**
 * GET /api/users?id=<userId> — fetch a single user's public profile.
 *
 * Used by the UserProfileSheet to display another user's info when their
 * avatar is clicked. Returns only public fields: avatar, name, username,
 * bio, role, status, lastSeenAt (respects lastSeenVisible), createdAt,
 * and message count.
 *
 * The current user's own profile is always fully visible (excluding
 * notificationPrefs — those are only returned by /api/auth/me).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const targetId = url.searchParams.get('id')
  if (!targetId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const isSelf = targetId === session.user.id

  const user = await db.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      username: true,
      email: isSelf, // only show email to self
      displayName: true,
      avatarUrl: true,
      bio: true,
      role: true,
      status: true,
      customStatus: true,
      lastSeenAt: true,
      lastSeenVisible: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  })

  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Respect lastSeenVisible — don't show lastSeenAt to others if hidden
  const response: any = { ...user }
  if (!isSelf && user.lastSeenVisible === false) {
    response.lastSeenAt = null
  }
  return NextResponse.json({ user: response })
}

// Update own profile
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id } = await params
  if (id !== 'me' && id !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = await req.json()

  // Validate input
  const parsed = profileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', details: parsed.error.issues }, { status: 400 })
  }

  const data = parsed.data

  // notificationPrefs is stored as JSON string — serialize it before saving
  const updateData: any = { ...data }
  if (data.notificationPrefs) {
    updateData.notificationPrefs = JSON.stringify(data.notificationPrefs)
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: updateData,
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

  // Parse notificationPrefs back into an object for the client
  const userResponse: any = { ...updated }
  if (updated.notificationPrefs) {
    try {
      userResponse.notificationPrefs = JSON.parse(updated.notificationPrefs)
    } catch {
      userResponse.notificationPrefs = null
    }
  }
  return NextResponse.json({ user: userResponse })
}
