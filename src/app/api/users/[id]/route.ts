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
})

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
