'use client'

import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { useSession } from 'next-auth/react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ChevronLeft, MoreVertical, Hash, Phone, Video, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { toast } from 'sonner'
import { useCall } from '@/hooks/useCall'
import { unlockAudio } from '@/lib/call-manager'
import { CallSounds } from '@/lib/call-sounds'

interface ChatHeaderProps {
  channel: any
}

export function ChatHeader({ channel }: ChatHeaderProps) {
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setChatInfoOpen = useAppStore((s) => s.setChatInfoOpen)
  const setView = useAppStore((s) => s.setView)
  const presence = usePresence()
  const { startCall } = useCall()
  const { data: session } = useSession()

  const isGroup = !channel.group?.isDm
  const isVoiceChannel = channel.type === 'voice'
  const partner = channel.partner

  const partnerStatus = partner ? presence[partner.id]?.status || partner.status || 'offline' : 'offline'

  const handleStartCall = async (video: boolean = false) => {
    try {
      // For DM channels, pass dmGroupId so the call is treated as a DM call
      // (rings the partner directly) rather than a persistent channel call.
      // For group text channels, pass channelId — the call lives in that channel.
      // For voice/video channels, the join happens from the Calls tab instead.
      const isDm = channel.group?.isDm
      const payload = isDm
        ? { dmGroupId: channel.group.id }
        : { channelId: channel.id }

      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()

      // Start our side of the call (mic + WebRTC)
      await startCall({ callId: data.call.id, channelId: channel.id, enableVideo: video })

      // Unlock audio on this user gesture
      unlockAudio()
      CallSounds.unlock()

      // For DM calls, ring the partner and play ringback tone
      if (partner && session?.user) {
        const myName = session.user.displayName || session.user.username || 'Someone'
        const { getSocket } = await import('@/lib/socket')
        const socket = await getSocket()
        socket.emit('call:ring', {
          callId: data.call.id,
          targetUserId: partner.id,
          from: {
            userId: session.user.id,
            username: session.user.username,
            displayName: myName,
          },
          channelId: channel.id,
          video,
        })
        // Play ringback tone (caller hears this while waiting)
        CallSounds.startRingback()
      }

      setView('voice')
    } catch {
      toast.error('Could not start call')
    }
  }

  return (
    <header className="h-16 shrink-0 flex items-center gap-3 px-3 md:px-5 border-b border-white/5 bg-background/60 backdrop-blur-3xl z-10 shadow-sm relative">
      {/* Back button — mobile only */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden h-10 w-10 shrink-0 rounded-xl hover:bg-white/5"
        onClick={() => setActiveChannel(null)}
      >
        <ChevronLeft className="w-5 h-5" />
      </Button>

      {/* Title */}
      <button
        onClick={() => setChatInfoOpen(true)}
        className="flex items-center gap-3.5 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left p-1 rounded-xl"
      >
        {isGroup ? (
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 shadow-sm ring-1 ring-primary/20">
            {isVoiceChannel ? (
              <Volume2 className="w-4 h-4 text-primary" />
            ) : (
              <Hash className="w-4 h-4 text-primary" />
            )}
          </div>
        ) : partner ? (
          <div className="relative shrink-0">
            <Avatar className="w-10 h-10 ring-1 ring-white/10 shadow-sm">
              <AvatarImage src={partner.avatarUrl || undefined} />
              <AvatarFallback>{partner.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute bottom-0 right-0 w-3 h-3 rounded-full border-[2.5px] border-background shadow-sm',
                partnerStatus === 'online' && 'bg-status-online',
                partnerStatus === 'idle' && 'bg-status-idle',
                partnerStatus === 'dnd' && 'bg-status-dnd',
                partnerStatus === 'offline' && 'bg-status-offline'
              )}
            />
          </div>
        ) : (
          <Avatar className="w-10 h-10 shrink-0 ring-1 ring-white/10 shadow-sm">
            <AvatarFallback>{channel.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-base tracking-tight truncate">
            {isGroup ? channel.name : partner?.displayName || channel.name}
          </div>
          {!isGroup && partner && (
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
              {partnerStatus === 'online' ? 'online' : partnerStatus}
            </div>
          )}
          {isGroup && channel.topic && (
            <div className="text-[11px] text-muted-foreground truncate">{channel.topic}</div>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl hover:bg-primary/10 hover:text-primary transition-all text-muted-foreground"
          title="Voice call"
          onClick={() => handleStartCall(false)}
        >
          <Phone className="w-[18px] h-[18px]" />
        </Button>
        {partner && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl hover:bg-primary/10 hover:text-primary transition-all text-muted-foreground"
            title="Video call"
            onClick={() => handleStartCall(true)}
          >
            <Video className="w-[18px] h-[18px]" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-xl hover:bg-white/5 transition-all text-muted-foreground"
          onClick={() => setChatInfoOpen(true)}
          title="Chat info"
        >
          <MoreVertical className="w-5 h-5" />
        </Button>
      </div>
    </header>
  )
}
