'use client'

import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { useSession } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ChevronLeft, MoreVertical, Hash, Phone, Volume2, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { toast } from 'sonner'
import { useVoiceCall } from '@/hooks/useVoiceCall'

interface ChatHeaderProps {
  channel: any
}

export function ChatHeader({ channel }: ChatHeaderProps) {
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setChatInfoOpen = useAppStore((s) => s.setChatInfoOpen)
  const setView = useAppStore((s) => s.setView)
  const presence = usePresence()
  const { startCall } = useVoiceCall()
  const [callPending, setCallPending] = useState(false)

  const isGroup = !channel.group?.isDm
  const isVoiceChannel = channel.type === 'voice'
  const partner = channel.partner

  // Partner presence for DMs
  const partnerStatus = partner ? presence[partner.id]?.status || partner.status || 'offline' : 'offline'

  const handleStartCall = async () => {
    setCallPending(true)
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      await startCall({ callId: data.call.id, channelId: channel.id })
      setView('voice')
      toast.success('Call started')
    } catch {
      toast.error('Failed to start call')
    } finally {
      setCallPending(false)
    }
  }

  return (
    <header className="h-14 shrink-0 flex items-center gap-2 px-2 md:px-4 border-b bg-background/95 backdrop-blur-xl z-10">
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
        ) : partner ? (
          <div className="relative shrink-0">
            <Avatar className="w-9 h-9">
              <AvatarImage src={partner.avatarUrl || undefined} />
              <AvatarFallback>{partner.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background',
                partnerStatus === 'online' && 'bg-status-online',
                partnerStatus === 'idle' && 'bg-status-idle',
                partnerStatus === 'dnd' && 'bg-status-dnd',
                partnerStatus === 'offline' && 'bg-status-offline'
              )}
            />
          </div>
        ) : (
          <Avatar className="w-9 h-9 shrink-0">
            <AvatarFallback>{channel.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] truncate">
            {isGroup ? channel.name : partner?.displayName || channel.name}
          </div>
          {!isGroup && partner && (
            <div className="text-xs text-muted-foreground truncate">
              {partnerStatus === 'online' ? 'online' : partnerStatus}
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
          onClick={handleStartCall}
          disabled={callPending}
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
