import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// List stories visible to me (not expired)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const now = new Date()

  // Get all non-expired stories
  const stories = await db.story.findMany({
    where: { expiresAt: { gt: now } },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      viewers: { select: { userId: true, viewedAt: true } },
      audienceList: { select: { userId: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Filter by audience
  const visible = stories.filter((s) => {
    if (s.userId === userId) return true
    if (s.audience === 'all') return true
    const inList = s.audienceList.some((a) => a.userId === userId)
    return s.audience === 'include' ? inList : !inList
  })

  // Group by user
  const byUser: Record<string, any> = {}
  for (const s of visible) {
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
  const userId = (session.user as any).id
  const body = await req.json()
  const { mediaUrl, mediaType = 'image', caption, audience = 'all', audienceUserIds = [] } = body

  if (!mediaUrl) return NextResponse.json({ error: 'mediaUrl required' }, { status: 400 })

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
