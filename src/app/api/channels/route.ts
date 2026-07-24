import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { getUserChannels } from '@/lib/chat-utils'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const channels = await getUserChannels((session.user as any).id)
  // Group by group
  const groups: Record<string, any> = {}
  for (const ch of channels) {
    if (!groups[ch.groupId]) {
      groups[ch.groupId] = {
        id: ch.group.id,
        name: ch.group.name,
        iconUrl: ch.group.iconUrl,
        isDm: ch.group.isDm,
        inviteCode: ch.group.inviteCode,
        ownerId: ch.group.ownerId,
        channels: [],
      }
    }
    groups[ch.groupId].channels.push(ch)
  }
  return NextResponse.json({ groups: Object.values(groups) })
}
