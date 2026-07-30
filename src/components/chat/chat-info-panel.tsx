'use client'

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Hash, Copy, Check, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ChatInfoPanelProps {
  channel: any
}

export function ChatInfoPanel({ channel }: ChatInfoPanelProps) {
  const chatInfoOpen = useAppStore((s) => s.chatInfoOpen)
  const setChatInfoOpen = useAppStore((s) => s.setChatInfoOpen)
  const presence = usePresence()

  // Track viewport — only render the desktop inline panel on lg+
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const { data: members } = useQuery({
    queryKey: ['channel-members', channel?.id],
    queryFn: async () => {
      const res = await fetch(`/api/channels/${channel.id}/members`)
      const data = await res.json()
      return data.members as any[]
    },
    enabled: !!channel?.id,
  })

  if (!channel) return null

  const isGroup = !channel.group?.isDm
  const inviteCode = channel.group?.inviteCode
  const partner = channel.partner

  const content = (
    <div className="flex flex-col h-full">
      {/* Header bar with close button (desktop only — the mobile Sheet has
          its own built-in close button via SheetContent). */}
      <div className="lg:flex hidden items-center justify-between px-4 py-3 border-b">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Info
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg hover:bg-accent"
          onClick={() => setChatInfoOpen(false)}
          aria-label="Close info panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Hero */}
      <div className="p-6 flex flex-col items-center text-center border-b">
        {isGroup ? (
          <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-3">
            <Hash className="w-9 h-9 text-primary" />
          </div>
        ) : partner ? (
          <Avatar className="w-20 h-20 mb-3">
            <AvatarImage src={partner.avatarUrl || undefined} />
            <AvatarFallback className="text-2xl">
              {partner.displayName?.charAt(0) || '?'}
            </AvatarFallback>
          </Avatar>
        ) : (
          <Avatar className="w-20 h-20 mb-3">
            <AvatarFallback className="text-2xl">
              {channel.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <h2 className="text-lg font-semibold">
          {isGroup ? channel.name : partner?.displayName || channel.name}
        </h2>
        {channel.topic && <p className="text-sm text-muted-foreground mt-0.5">{channel.topic}</p>}
        {!isGroup && partner && (
          <p className="text-sm text-muted-foreground mt-0.5">@{partner.username}</p>
        )}

        {isGroup && inviteCode && (
          <div className="mt-4 w-full">
            <InviteCodeButton code={inviteCode} />
          </div>
        )}
      </div>

      {/* Members */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Members · {members?.length || 0}
          </h3>
          <div className="space-y-0.5">
            {members?.map((m) => {
              const status = presence[m.id]?.status || m.status || 'offline'
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50"
                >
                  <div className="relative shrink-0">
                    <Avatar className="w-9 h-9">
                      <AvatarImage src={m.avatarUrl || undefined} />
                      <AvatarFallback>{m.displayName?.charAt(0) || '?'}</AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-background',
                        status === 'online' && 'bg-status-online',
                        status === 'idle' && 'bg-status-idle',
                        status === 'dnd' && 'bg-status-dnd',
                        status === 'offline' && 'bg-status-offline'
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.displayName}</div>
                    <div className="text-xs text-muted-foreground truncate">@{m.username}</div>
                  </div>
                  {m.role === 'owner' && (
                    <span className="text-[10px] uppercase font-bold text-primary">Owner</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  )

  // Desktop: inline right panel (only shown when chatInfoOpen AND on desktop)
  // Mobile: Sheet that slides in from right
  if (isDesktop) {
    if (!chatInfoOpen) return null
    return (
      <div className="hidden lg:flex w-80 shrink-0 border-l bg-sidebar">
        {content}
      </div>
    )
  }

  return (
    <Sheet open={chatInfoOpen} onOpenChange={setChatInfoOpen}>
      <SheetContent side="right" className="w-full sm:w-96 p-0">
        {content}
      </SheetContent>
    </Sheet>
  )
}

function InviteCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(code)
        setCopied(true)
        toast.success('Invite code copied')
        setTimeout(() => setCopied(false), 1500)
      }}
      className="w-full flex items-center justify-between gap-2 text-sm bg-muted hover:bg-accent rounded-lg px-3 py-2 transition-colors"
    >
      <span className="text-muted-foreground">Invite code</span>
      <span className="font-mono font-medium flex items-center gap-1.5">
        {code.slice(0, 8)}...
        {copied ? <Check className="w-3.5 h-3.5 text-status-online" /> : <Copy className="w-3.5 h-3.5" />}
      </span>
    </button>
  )
}
