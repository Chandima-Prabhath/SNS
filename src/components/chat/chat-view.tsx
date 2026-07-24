'use client'

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { ChannelList, JoinGroupButton, StartDmButton } from './channel-list'
import { MessageList } from './message-list'
import { MessageComposer } from './message-composer'
import { Hash, Volume2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { StartVoiceCallButton } from '@/components/voice/voice-controls'

export function ChatView() {
  const activeChannelId = useAppStore((s) => s.activeChannelId)

  // Look up channel info
  const { data: channelInfo } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  const activeChannel = channelInfo
    ?.flatMap((g) => g.channels)
    .find((c) => c.id === activeChannelId)

  return (
    <div className="flex h-full">
      {/* Channel list — left sidebar */}
      <div className="w-64 shrink-0 border-r bg-card hidden md:flex flex-col">
        <div className="p-3 border-b space-y-2">
          <JoinGroupButton />
          <StartDmButton />
        </div>
        <div className="flex-1 min-h-0">
          <ChannelList />
        </div>
      </div>

      {/* Messages — main */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannelId && activeChannel ? (
          <>
            <div className="h-12 border-b flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {activeChannel.type === 'voice' ? (
                  <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span className="font-semibold truncate">{activeChannel.name}</span>
                {activeChannel.topic && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-sm text-muted-foreground truncate">{activeChannel.topic}</span>
                  </>
                )}
              </div>
              <ChannelMembers channelId={activeChannelId} />
            </div>
            <MessageList channelId={activeChannelId} />
            <MessageComposer channelId={activeChannelId} />
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}

function ChannelMembers({ channelId }: { channelId: string }) {
  const { data } = useQuery({
    queryKey: ['channel-members', channelId],
    queryFn: async () => {
      const res = await fetch(`/api/channels/${channelId}/members`)
      const data = await res.json()
      return data.members as any[]
    },
  })
  if (!data || data.length === 0) return null
  return (
    <div className="flex -space-x-2">
      {data.slice(0, 5).map((m) => (
        <Avatar key={m.id} className="w-6 h-6 border-2 border-background">
          <AvatarImage src={m.avatarUrl || undefined} />
          <AvatarFallback className="text-[10px]">
            {m.displayName?.charAt(0) || '?'}
          </AvatarFallback>
        </Avatar>
      ))}
      {data.length > 5 && (
        <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] font-medium">
          +{data.length - 5}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center space-y-3 max-w-sm">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
          <Hash className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">No channel selected</h2>
        <p className="text-sm text-muted-foreground">
          Pick a channel from the left, start a DM, or join a group with an invite code.
        </p>
        <p className="text-xs text-muted-foreground">
          If this is your first time here, ask an admin to seed the default group — or click below.
        </p>
        <Button onClick={async () => {
          const res = await fetch('/api/seed', { method: 'POST' })
          if (res.ok) {
            window.location.reload()
          }
        }}>
          Seed default group
        </Button>
      </div>
    </div>
  )
}
