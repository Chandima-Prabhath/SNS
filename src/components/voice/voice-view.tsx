'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCall } from '@/hooks/useCall'
import { useAppStore } from '@/stores/useAppStore'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Phone, PhoneOff, Volume2, Radio, PhoneIncoming, PhoneOutgoing, PhoneMissed, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ActiveCallScreen } from './active-call-screen'
import { unlockAudio } from '@/lib/call-manager'
import { formatDistanceToNow } from 'date-fns'

export function VoiceView() {
  const { status, callId, isVideoCall, startCall, endCall } = useCall()
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

  const { data: callHistory } = useQuery({
    queryKey: ['call-history'],
    queryFn: async () => {
      const res = await fetch('/api/calls/history')
      const data = await res.json()
      return data.calls as any[]
    },
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

  return (
    <div className="h-full overflow-y-auto bg-background pb-20 lg:pb-0">
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground">Voice channels & call history</p>
        </div>

        {/* Active voice channels */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Voice Channels
          </h2>
          {voiceChannels.length === 0 ? (
            <Card className="p-10 text-center border-dashed">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-3 ring-1 ring-primary/15">
                <Volume2 className="w-8 h-8 text-primary" strokeWidth={1.5} />
              </div>
              <p className="font-medium text-base">No voice channels</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                Go to Settings → Admin to create a voice channel in your group.
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
                      <Phone className="w-4 h-4" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Call history */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Recent Calls
          </h2>
          {!callHistory || callHistory.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <p className="text-sm text-muted-foreground">No call history yet.</p>
            </Card>
          ) : (
            <div className="space-y-1">
              {callHistory.slice(0, 15).map((call: any) => {
                const otherParticipants = call.participants.filter((p: any) => p.userId !== (call.starter?.id))
                const startedByMe = call.startedBy === call.participants[0]?.userId
                const isMissed = call.status === 'ended' && !call.endedAt
                return (
                  <div
                    key={call.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors"
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                      isMissed ? 'bg-red-500/15' : 'bg-primary/10'
                    )}>
                      {isMissed ? (
                        <PhoneMissed className="w-5 h-5 text-red-500" />
                      ) : startedByMe ? (
                        <PhoneOutgoing className="w-5 h-5 text-primary" />
                      ) : (
                        <PhoneIncoming className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {call.channel?.group?.isDm
                          ? otherParticipants[0]?.user?.displayName || 'Unknown'
                          : call.channel?.name || 'Voice Call'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
                        {call.endedAt && ` · ${Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 60000)}m`}
                      </div>
                    </div>
                    {call.channel && (
                      <button
                        onClick={() => startCallMutation.mutate(call.channel.id)}
                        className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
