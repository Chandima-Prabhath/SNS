import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { z } from 'zod'

const createStorySchema = z.object({
  mediaUrl: z.string().startsWith('/api/uploads/'),
  mediaType: z.enum(['image', 'video', 'text']),
  caption: z.string().max(2000).optional(),
  audience: z.enum(['all', 'include', 'exclude']),
  audienceUserIds: z.array(z.string()).max(100).optional(),
})

// List stories visible to me (not expired)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const now = new Date()

  // Get non-expired stories visible to me — filtered in DB, not in JS.
  // This avoids loading ALL stories + audience lists into memory.
  const stories = await db.story.findMany({
    where: {
      expiresAt: { gt: now },
      OR: [
        { userId }, // my own stories
        { audience: 'all' }, // public stories
        {
          audience: 'include',
          audienceList: { some: { userId } }, // I'm in the include list
        },
        {
          audience: 'exclude',
          audienceList: { none: { userId } }, // I'm NOT in the exclude list
        },
      ],
    },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      viewers: { select: { userId: true, viewedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Group by user
  const byUser: Record<string, any> = {}
  for (const s of stories) {
    if (!byUser[s.userId]) {
      byUser[s.userId] = {
        userId: s.userId,
        user: s.user,
        stories: [],
      }
    }
    const viewedByMe = s.viewers.some((v) => v.userId === userId)
    byUser[s.userId].stories.push({
      id: s.id,
      mediaUrl: s.mediaUrl,
      mediaType: s.mediaType,
      caption: s.caption,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      viewedByMe,
      viewerCount: s.viewers.length,
    })
  }

  // My own stories include the viewers list
  const myStories = byUser[userId]
  if (myStories) {
    const fullStories = await db.story.findMany({
      where: { userId, expiresAt: { gt: now } },
      include: { viewers: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } } },
      orderBy: { createdAt: 'asc' },
    })
    myStories.stories = fullStories.map((s) => ({
      id: s.id,
      mediaUrl: s.mediaUrl,
      mediaType: s.mediaType,
      caption: s.caption,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      viewers: s.viewers.map((v) => ({ userId: v.userId, user: v.user, viewedAt: v.viewedAt })),
    }))
  }

  return NextResponse.json({ stories: Object.values(byUser) })
}

// Upload a new story
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const body = await req.json().catch(() => ({}))
  const parsed = createStorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid input', details: parsed.error.issues }, { status: 400 })
  }
  const { mediaUrl, mediaType, caption, audience, audienceUserIds = [] } = parsed.data

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
  const story = await db.story.create({
    data: {
      userId,
      mediaUrl,
      mediaType,
      caption: caption || null,
      audience,
      expiresAt,
      ...(audience !== 'all' && audienceUserIds.length > 0
        ? { audienceList: { create: audienceUserIds.map((id: string) => ({ userId: id })) } }
        : {}),
    },
  })

  return NextResponse.json({ story })
}
