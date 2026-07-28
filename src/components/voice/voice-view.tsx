'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCall } from '@/hooks/useCall'
import { useAppStore } from '@/stores/useAppStore'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Phone, PhoneOff, Volume2, Radio, PhoneIncoming, PhoneOutgoing,
  PhoneMissed, Users, Video, Mic, Plus, Clock, Headphones, Signal,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ActiveCallScreen } from './active-call-screen'
import { unlockAudio } from '@/lib/call-manager'
import { formatDistanceToNow } from 'date-fns'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'

export function VoiceView() {
  const { status, callId, isVideoCall, startCall, endCall } = useCall()
  const setView = useAppStore((s) => s.setView)
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  // All voice + video channels across all groups
  const voiceChannels =
    groups?.flatMap((g) =>
      g.channels
        .filter((c: any) => c.type === 'voice' || c.type === 'video')
        .map((c: any) => ({ ...c, groupName: g.name, groupIcon: g.iconUrl, groupId: g.id }))
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

  // Split active calls into "mine" (channels I've joined) and "other ongoing"
  const myActiveCall = activeCalls?.find((c: any) =>
    c.participants?.some((p: any) => p.userId === myId && !p.leftAt)
  )
  const otherActiveCalls = activeCalls?.filter((c: any) =>
    !c.participants?.some((p: any) => p.userId === myId && !p.leftAt)
  ) || []

  return (
    <div className="h-full overflow-y-auto mesh-gradient pb-20 lg:pb-0">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Voice & video channels · ongoing calls · history
          </p>
        </div>

        {/* Active call banner — if I'm in a call, show it at the top */}
        {myActiveCall && (
          <ActiveCallBanner
            call={myActiveCall}
            groups={groups || []}
            onReturn={() => setView('voice')}
          />
        )}

        {/* Voice & Video Channels */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Headphones className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Channels
            </h2>
          </div>
          {voiceChannels.length === 0 ? (
            <Card className="p-10 text-center border-dashed">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-3 ring-1 ring-primary/15">
                <Volume2 className="w-8 h-8 text-primary" strokeWidth={1.5} />
              </div>
              <p className="font-medium text-base">No voice channels yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                Ask an admin to create a voice or video channel in your group.
              </p>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {voiceChannels.map((ch: any) => {
                const activeCall = activeCalls?.find((c) => c.channelId === ch.id)
                const inCall = activeCall?.participants?.filter((p: any) => !p.leftAt).length || 0
                const isVideo = ch.type === 'video'
                const Icon = isVideo ? Video : Volume2
                return (
                  <motion.button
                    key={ch.id}
                    onClick={() => startCallMutation.mutate(ch.id)}
                    disabled={startCallMutation.isPending}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'group relative w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all',
                      'bg-card border border-border/50 hover:border-primary/30 hover:bg-accent/50',
                      inCall > 0 && 'border-primary/30 bg-primary/5'
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors',
                        isVideo ? 'bg-emerald-500/15 text-emerald-400' : 'bg-primary/15 text-primary',
                        inCall > 0 && 'ring-2 ring-primary/30'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[15px] truncate">{ch.name}</div>
                      <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        <span>{ch.groupName}</span>
                        <span>·</span>
                        {inCall > 0 ? (
                          <span className="text-status-online flex items-center gap-1 font-medium">
                            <Radio className="w-3 h-3 animate-pulse" />
                            {inCall} live
                          </span>
                        ) : (
                          <span>empty</span>
                        )}
                      </div>
                    </div>

                    {/* Live participants */}
                    {activeCall && inCall > 0 && (
                      <div className="flex -space-x-2 mr-1">
                        {activeCall.participants
                          .filter((p: any) => !p.leftAt)
                          .slice(0, 3)
                          .map((p: any) => (
                            <Avatar key={p.userId} className="w-6 h-6 border-2 border-card">
                              <AvatarImage src={p.user?.avatarUrl || undefined} />
                              <AvatarFallback className="text-[10px] bg-muted">
                                {p.user?.displayName?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                      </div>
                    )}

                    {/* Join button */}
                    <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <Phone className="w-4 h-4" />
                    </div>
                  </motion.button>
                )
              })}
            </div>
          )}
        </section>

        {/* Other ongoing calls — channels with activity I haven't joined */}
        {otherActiveCalls.length > 0 && otherActiveCalls.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Radio className="w-4 h-4 text-status-online animate-pulse" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ongoing Calls
              </h2>
            </div>
            <div className="space-y-2">
              {otherActiveCalls.slice(0, 5).map((call: any) => {
                const channel = voiceChannels.find((c) => c.id === call.channelId)
                if (!channel) return null
                const liveCount = call.participants?.filter((p: any) => !p.leftAt).length || 0
                return (
                  <button
                    key={call.id}
                    onClick={() => startCallMutation.mutate(call.channelId)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-primary/20 hover:bg-accent/50 transition-colors text-left"
                  >
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                        <Volume2 className="w-4 h-4 text-primary" />
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-status-online border-2 border-card" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{channel.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {channel.groupName} · {liveCount} active
                      </div>
                    </div>
                    <span className="text-xs font-medium text-primary px-3 py-1.5 rounded-full bg-primary/10">
                      Join
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* Call history */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent Calls
            </h2>
          </div>
          {!callHistory || callHistory.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-muted flex items-center justify-center mb-3">
                <PhoneOff className="w-6 h-6 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <p className="text-sm text-muted-foreground">No call history yet.</p>
            </Card>
          ) : (
            <div className="space-y-1">
              {callHistory.slice(0, 20).map((call: any) => {
                const otherParticipants = call.participants.filter((p: any) => p.userId !== myId)
                const startedByMe = call.startedBy === myId
                const isMissed = call.status === 'ended' && !call.endedAt
                const duration = call.endedAt
                  ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 60000)
                  : 0
                const partner = otherParticipants[0]?.user
                const isDm = call.channel?.group?.isDm
                return (
                  <div
                    key={call.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent/50 transition-colors"
                  >
                    {/* Avatar / icon */}
                    <div className="relative shrink-0">
                      {isDm && partner ? (
                        <Avatar className="w-11 h-11">
                          <AvatarImage src={partner.avatarUrl || undefined} />
                          <AvatarFallback>{partner.displayName?.charAt(0) || '?'}</AvatarFallback>
                        </Avatar>
                      ) : (
                        <div
                          className={cn(
                            'w-11 h-11 rounded-full flex items-center justify-center',
                            isMissed ? 'bg-red-500/15' : 'bg-primary/10'
                          )}
                        >
                          {isMissed ? (
                            <PhoneMissed className="w-5 h-5 text-red-500" />
                          ) : startedByMe ? (
                            <PhoneOutgoing className="w-5 h-5 text-primary" />
                          ) : (
                            <PhoneIncoming className="w-5 h-5 text-primary" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {isDm ? partner?.displayName || 'Unknown' : call.channel?.name || 'Voice Call'}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span>
                          {isMissed ? 'Missed' : startedByMe ? 'Outgoing' : 'Incoming'}
                        </span>
                        <span>·</span>
                        <span>{formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}</span>
                        {call.endedAt && duration > 0 && (
                          <>
                            <span>·</span>
                            <span>{duration}m</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Call back button */}
                    {call.channel && (
                      <button
                        onClick={() => startCallMutation.mutate(call.channel.id)}
                        className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
                        title="Call back"
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

/**
 * Banner shown at the top of the Calls tab when the user is currently in a
 * call. Lets them return to the active call screen.
 */
function ActiveCallBanner({ call, groups, onReturn }: { call: any; groups: any[]; onReturn: () => void }) {
  const allChannels = groups.flatMap((g: any) =>
    g.channels.map((c: any) => ({ ...c, groupName: g.name, isDm: g.isDm, partner: g.partner }))
  )
  const channel = allChannels.find((c: any) => c.id === call.channelId)
  const name = channel?.isDm ? channel.partner?.displayName : channel?.name || 'Call'
  const liveCount = call.participants?.filter((p: any) => !p.leftAt).length || 0

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-4 bg-primary/10 border border-primary/20 flex items-center gap-3"
    >
      <div className="relative">
        <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center">
          <Volume2 className="w-5 h-5 text-primary" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-status-online border-2 border-background pulse-glow" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Radio className="w-3 h-3 animate-pulse text-status-online" />
          {liveCount} in call · tap to return
        </div>
      </div>
      <button
        onClick={onReturn}
        className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
      >
        Return
      </button>
    </motion.div>
  )
}
