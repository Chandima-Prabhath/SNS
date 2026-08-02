import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// Mark a story as viewed
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: storyId } = await params

  // Load the story first to check the audience filter
  const story = await db.story.findUnique({
    where: { id: storyId },
    select: { id: true, userId: true, audience: true },
  })
  if (!story) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // Owner can always view their own story
  if (story.userId !== userId) {
    if (story.audience === 'include') {
      const inInclude = await db.storyAudience.findUnique({
        where: { storyId_userId: { storyId, userId } },
      })
      if (!inInclude) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    } else if (story.audience === 'exclude') {
      const inExclude = await db.storyAudience.findUnique({
        where: { storyId_userId: { storyId, userId } },
      })
      if (inExclude) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
    }
    // audience === 'all' → allow
  }

  await db.storyViewer.upsert({
    where: { storyId_userId: { storyId, userId } },
    create: { storyId, userId },
    update: {},
  })

  return NextResponse.json({ ok: true })
}

// Delete my own story
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: storyId } = await params

  const story = await db.story.findUnique({ where: { id: storyId } })
  if (!story) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (story.userId !== userId && session.user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await db.story.delete({ where: { id: storyId } })
  return NextResponse.json({ ok: true })
}
