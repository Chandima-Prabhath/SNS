'use client'

import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ChevronLeft, MoreVertical, Hash, Phone, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatHeaderProps {
  channel: any
}

export function ChatHeader({ channel }: ChatHeaderProps) {
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setChatInfoOpen = useAppStore((s) => s.setChatInfoOpen)
  const presence = usePresence()

  // For DMs, find the partner user. For groups, show the channel name.
  const isGroup = !channel.group?.isDm
  const isVoiceChannel = channel.type === 'voice'

  // Look up partner's presence if this is a DM (we need to know who the partner is — comes from members)
  // For simplicity in header, we just show the channel name; the info panel handles partner lookup
  const partnerStatus = 'online' // placeholder — presence is updated in real-time elsewhere

  return (
    <header
      className="h-14 shrink-0 flex items-center gap-2 px-2 md:px-4 border-b bg-background/95 backdrop-blur-xl z-10"
    >
      {/* Back button — mobile only */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden h-9 w-9 shrink-0"
        onClick={() => setActiveChannel(null)}
      >
        <ChevronLeft className="w-5 h-5" />
      </Button>

      {/* Title */}
      <button
        onClick={() => setChatInfoOpen(true)}
        className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
      >
        {isGroup ? (
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            {isVoiceChannel ? (
              <Volume2 className="w-4 h-4 text-primary" />
            ) : (
              <Hash className="w-4 h-4 text-primary" />
            )}
          </div>
        ) : (
          <Avatar className="w-9 h-9 shrink-0">
            <AvatarFallback>
              {channel.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] truncate">
            {channel.name}
          </div>
          {!isGroup && (
            <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <span className={cn('w-1.5 h-1.5 rounded-full bg-status-online')} />
              online
            </div>
          )}
          {isGroup && channel.topic && (
            <div className="text-xs text-muted-foreground truncate">{channel.topic}</div>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          title="Voice call"
          onClick={() => {
            // Voice calls are now in the Calls tab
            // For DMs, the user can start a call from there
          }}
        >
          <Phone className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setChatInfoOpen(true)}
          title="Chat info"
        >
          <MoreVertical className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}
