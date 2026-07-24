'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVoiceCall } from '@/hooks/useVoiceCall'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Phone, PhoneOff, Mic, MicOff, Volume2, Users, Loader2, Radio, Wifi, Cloud } from 'lucide-react'
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

  // Track connection types per peer (P2P vs TURN)
  const [connectionTypes, setConnectionTypes] = useState<Record<string, 'p2p' | 'turn' | 'unknown'>>({})
  // Track audio levels per peer (for active-speaker visual)
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({})

  // Hook into the voice call manager's onConnectionType and onAudioLevel callbacks
  // We do this by intercepting the callbacks via a custom event the hook dispatches
  useEffect(() => {
    const onConnType = (e: Event) => {
      const { peerId, type } = (e as CustomEvent).detail
      setConnectionTypes((prev) => ({ ...prev, [peerId]: type }))
    }
    const onAudioLevel = (e: Event) => {
      const { peerId, level } = (e as CustomEvent).detail
      setAudioLevels((prev) => ({ ...prev, [peerId]: level }))
    }
    window.addEventListener('sns:connection-type', onConnType as EventListener)
    window.addEventListener('sns:audio-level', onAudioLevel as EventListener)
    return () => {
      window.removeEventListener('sns:connection-type', onConnType as EventListener)
      window.removeEventListener('sns:audio-level', onAudioLevel as EventListener)
    }
  }, [])

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

  // Determine overall connection type for the call
  const connTypeValues = Object.values(connectionTypes)
  const overallType: 'p2p' | 'turn' | 'mixed' | 'unknown' =
    connTypeValues.length === 0
      ? 'unknown'
      : connTypeValues.every((t) => t === 'p2p')
        ? 'p2p'
        : connTypeValues.every((t) => t === 'turn')
          ? 'turn'
          : 'mixed'

  const turnProviders = iceServers?.providers?.filter((p: any) => p.enabled && p.type === 'turn') || []

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground">
            Drop-in voice channels ·{' '}
            {turnProviders.length > 0 ? (
              <span className="text-status-online font-medium">
                {turnProviders.length} TURN provider(s) active
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
              <div className="flex items-center gap-3">
                {/* Connection type indicator */}
                <ConnectionTypeBadge type={overallType} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  {participants.size + 1}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <ParticipantTile
                name="You"
                muted={localMuted}
                isLocal
                stream={localStream}
                level={1 - (localMuted ? 1 : 0)} // visual hint
              />
              {Array.from(participants.entries()).map(([peerId, p]) => (
                <ParticipantTile
                  key={peerId}
                  name={p.username}
                  muted={p.muted}
                  stream={p.stream}
                  level={audioLevels[peerId] || 0}
                  connectionType={connectionTypes[peerId]}
                />
              ))}
            </div>

            {/* Audio quality info */}
            <div className="text-xs text-muted-foreground mb-4 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <Radio className="w-3 h-3" /> Echo cancellation · Noise suppression · Auto-gain
              </span>
              <span>·</span>
              <span>Silence detection: auto-mutes when you stop speaking (saves bandwidth)</span>
            </div>

            <div className="flex justify-center gap-3">
              <Button
                variant={localMuted ? 'destructive' : 'secondary'}
                size="lg"
                onClick={toggleMute}
                className="rounded-full h-12 w-12 p-0"
                title={localMuted ? 'Unmute' : 'Mute'}
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

function ConnectionTypeBadge({ type }: { type: 'p2p' | 'turn' | 'mixed' | 'unknown' }) {
  if (type === 'unknown') return null
  const config = {
    p2p: { label: 'P2P', icon: Wifi, color: 'bg-status-online/20 text-status-online' },
    turn: { label: 'TURN', icon: Cloud, color: 'bg-primary/20 text-primary' },
    mixed: { label: 'Mixed', icon: Cloud, color: 'bg-status-idle/20 text-status-idle' },
  }[type]
  const Icon = config.icon
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full', config.color)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

function ParticipantTile({
  name,
  muted,
  isLocal,
  stream,
  level = 0,
  connectionType,
}: {
  name: string
  muted: boolean
  isLocal?: boolean
  stream?: MediaStream | null
  level?: number
  connectionType?: 'p2p' | 'turn' | 'unknown'
}) {
  // Active-speaker glow: ring intensifies with audio level
  const glowIntensity = Math.min(level * 3, 1)
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-muted/50 relative">
      <div
        className="relative"
        style={{
          filter: glowIntensity > 0.1 ? `drop-shadow(0 0 ${8 + glowIntensity * 12}px oklch(0.7 0.18 145 / ${glowIntensity}))` : undefined,
        }}
      >
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
      {!isLocal && connectionType && (
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {connectionType === 'p2p' ? 'P2P' : connectionType === 'turn' ? 'TURN' : ''}
        </div>
      )}
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
