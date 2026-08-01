import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import type { BotFlow } from '@/lib/bot/flow-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/channels/[id]/commands
 *
 * Returns the available /commands and @mentionable users/bots in a channel.
 * Used by the chat composer's autocomplete UI.
 *
 * Commands are extracted from visual bot flows — each bot's trigger node
 * with triggerType='command' and a command field contributes one command.
 * Built-in bot modules (echo, help, poll, remind) also contribute their
 * command handlers.
 *
 * Mentionable users are all channel members (users + bots).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const { id: channelId } = await params

  // Verify channel membership
  const membership = await db.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
  })
  if (!membership) return NextResponse.json({ error: 'not a member' }, { status: 403 })

  // Get all channel members (users + bots) for @mention suggestions
  const channelMembers = await db.channelMember.findMany({
    where: { channelId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  })

  // Get bot IDs to mark which members are bots
  const allBots = await db.bot.findMany({ where: { enabled: true }, select: { id: true } })
  const botIds = new Set(allBots.map((b) => b.id))

  const mentionable = channelMembers
    .filter((m) => m.user && m.userId !== userId)
    .map((m) => ({
      id: m.user.id,
      username: m.user.username,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
      isBot: botIds.has(m.user.id),
    }))

  // Get all bots that are members of this channel
  const memberBotIds = channelMembers.map((m) => m.userId)
  const bots = memberBotIds.length > 0
    ? await db.bot.findMany({
        where: { id: { in: memberBotIds }, enabled: true },
        select: { id: true, name: true, username: true, module: true, flow: true, config: true },
      })
    : []

  // Extract commands from visual bot flows
  const commands: { name: string; description: string; botName: string; botUsername: string }[] = []

  for (const bot of bots) {
    if (bot.module === 'visual' && bot.flow) {
      try {
        const flow = JSON.parse(bot.flow) as BotFlow
        for (const node of flow.nodes || []) {
          if (node.type === 'trigger' && node.data.triggerType === 'command' && node.data.command) {
            commands.push({
              name: node.data.command.replace(/^\//, ''),
              description: `Trigger for ${bot.name}`,
              botName: bot.name,
              botUsername: bot.username,
            })
          }
        }
      } catch {
        // flow parse error — skip this bot
      }
    }
  }

  // Also add built-in bot module commands
  try {
    const { listBotModules } = await import('@/lib/bot')
    const modules = listBotModules()
    for (const bot of bots) {
      if (bot.module !== 'visual') {
        const mod = modules.find((m) => m.name === bot.module)
        if (mod) {
          for (const cmd of mod.commands) {
            commands.push({
              name: cmd.name,
              description: cmd.description,
              botName: bot.name,
              botUsername: bot.username,
            })
          }
        }
      }
    }
  } catch {
    // bot module listing failed — just use visual flow commands
  }

  return NextResponse.json({
    commands,
    mentionable,
  })
}
