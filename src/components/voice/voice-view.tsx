'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVoiceCall } from '@/hooks/useVoiceCall'
import { useAppStore } from '@/stores/useAppStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Phone, PhoneOff, Mic, MicOff, Volume2, Users, Loader2, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function VoiceView() {
  const {
    status,
    callId,
    localStream,
    localMuted,
    participants,
    iceServers,
    error,
    startCall,
    toggleMute,
    leaveCall,
  } = useVoiceCall()
  const qc = useQueryClient()

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
      toast.success('Joined voice channel')
    },
    onError: () => toast.error('Failed to join voice'),
  })

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground">
            Drop-in voice channels ·{' '}
            {iceServers?.providers?.filter((p: any) => p.enabled && p.type === 'turn').length > 0 ? (
              <span className="text-status-online font-medium">
                {iceServers.providers.filter((p: any) => p.enabled && p.type === 'turn').length} TURN provider(s) active
              </span>
            ) : (
              <span className="text-status-idle">STUN only</span>
            )}
          </p>
        </div>

        {/* Active call panel */}
        {status !== 'idle' && callId && (
          <Card className="p-6 border-primary/40 bg-card">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Live</div>
                  <div className="text-lg font-semibold">
                    {status === 'connecting' ? 'Connecting...' : 'In call'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                {participants.size + 1}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <ParticipantTile name="You" muted={localMuted} isLocal stream={localStream} />
              {Array.from(participants.entries()).map(([peerId, p]) => (
                <ParticipantTile
                  key={peerId}
                  name={p.username}
                  muted={p.muted}
                  stream={p.stream}
                />
              ))}
            </div>

            <div className="flex justify-center gap-3">
              <Button
                variant={localMuted ? 'destructive' : 'secondary'}
                size="lg"
                onClick={toggleMute}
                className="rounded-full h-12 w-12 p-0"
              >
                {localMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={leaveCall}
                className="rounded-full h-12 px-6"
              >
                <PhoneOff className="w-5 h-5 mr-2" /> Leave
              </Button>
            </div>
            {error && <div className="text-sm text-red-500 text-center mt-2">{error}</div>}
          </Card>
        )}

        {/* Voice channels list */}
        {status === 'idle' && (
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
        )}
      </div>
    </div>
  )
}

function ParticipantTile({
  name,
  muted,
  isLocal,
  stream,
}: {
  name: string
  muted: boolean
  isLocal?: boolean
  stream?: MediaStream | null
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-muted/50">
      <div className="relative">
        <Avatar className="w-16 h-16">
          <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        {muted && (
          <div className="absolute -bottom-1 -right-1 bg-red-500 text-white rounded-full p-1 border-2 border-background">
            <MicOff className="w-3 h-3" />
          </div>
        )}
      </div>
      <div className="text-sm font-medium">
        {name} {isLocal && <span className="text-muted-foreground">(you)</span>}
      </div>
      {!isLocal && stream && <AudioPlayer stream={stream} />}
    </div>
  )
}

function AudioPlayer({ stream }: { stream: MediaStream }) {
  return (
    <audio
      autoPlay
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream
      }}
    />
  )
}
