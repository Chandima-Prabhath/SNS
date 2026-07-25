'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCall } from '@/hooks/useCall'
import { useAppStore } from '@/stores/useAppStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Phone, PhoneOff, Mic, MicOff, Volume2, Users, Loader2, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ActiveCallScreen } from './active-call-screen'
import { unlockAudio } from '@/lib/call-manager'

export function VoiceView() {
  const { status, callId, isVideoCall, startCall, endCall, participants } = useCall()
  const qc = useQueryClient()
  const setView = useAppStore((s) => s.setView)

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  const voiceChannels =
    groups?.flatMap((g) =>
      g.channels.filter((c: any) => c.type === 'voice').map((c: any) => ({ ...c, groupName: g.name }))
    ) || []

  const { data: activeCalls } = useQuery({
    queryKey: ['active-calls'],
    queryFn: async () => {
      const res = await fetch('/api/calls')
      const data = await res.json()
      return data.calls as any[]
    },
    refetchInterval: status === 'idle' ? 5000 : false,
  })

  const startCallMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: async (data) => {
      await startCall({ callId: data.call.id, channelId: data.call.channelId })
      unlockAudio()
      toast.success('Joined voice channel')
    },
    onError: () => toast.error('Failed to join voice'),
  })

  // When in an active call, show the full-screen call UI
  if (status !== 'idle' && callId) {
    const allChannels = groups?.flatMap((g: any) =>
      g.channels.map((c: any) => ({ ...c, groupName: g.name, isDm: g.isDm, partner: g.partner }))
    ) || []

    let callName = 'Voice Call'
    let callAvatarUrl: string | undefined
    let isGroup = true

    const activeCall = activeCalls?.find((c: any) => c.id === callId)
    if (activeCall?.channelId) {
      const channel = allChannels.find((c: any) => c.id === activeCall.channelId)
      if (channel) {
        if (channel.isDm && channel.partner) {
          callName = channel.partner.displayName
          callAvatarUrl = channel.partner.avatarUrl || undefined
          isGroup = false
        } else {
          callName = channel.name
          isGroup = true
        }
      }
    }

    return (
      <ActiveCallScreen
        callName={callName}
        callAvatarUrl={callAvatarUrl}
        isGroup={isGroup}
        isVideoCall={isVideoCall}
        onLeave={() => setView('chats')}
      />
    )
  }

  const turnProviders = participants

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground">Drop-in voice channels</p>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Voice Channels
          </h2>
          {voiceChannels.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <Volume2 className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No voice channels yet. Ask an admin to create one in a group.
              </p>
            </Card>
          ) : (
            <div className="space-y-1">
              {voiceChannels.map((ch: any) => {
                const activeCall = activeCalls?.find((c) => c.channelId === ch.id)
                const inCall = activeCall?.participants?.length || 0
                return (
                  <button
                    key={ch.id}
                    onClick={() => startCallMutation.mutate(ch.id)}
                    disabled={startCallMutation.isPending}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors text-left disabled:opacity-50"
                  >
                    <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                      <Volume2 className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[15px] truncate">{ch.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {ch.groupName} ·{' '}
                        {inCall > 0 ? (
                          <span className="text-status-online flex items-center gap-1 inline-flex">
                            <Radio className="w-3 h-3 animate-pulse" />
                            {inCall} live
                          </span>
                        ) : (
                          'empty'
                        )}
                      </div>
                    </div>
                    {activeCall && (
                      <div className="flex -space-x-2 mr-2">
                        {activeCall.participants.slice(0, 3).map((p: any) => (
                          <Avatar key={p.userId} className="w-6 h-6 border-2 border-background">
                            <AvatarImage src={p.user.avatarUrl || undefined} />
                            <AvatarFallback className="text-[10px]">
                              {p.user.displayName?.charAt(0) || '?'}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                    )}
                    <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                      {startCallMutation.isPending && startCallMutation.variables === ch.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Phone className="w-4 h-4" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
