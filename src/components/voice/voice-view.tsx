'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVoiceCall } from '@/hooks/useVoiceCall'
import { useAppStore } from '@/stores/useAppStore'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Phone, PhoneOff, Mic, MicOff, Volume2, Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function VoiceView() {
  const { status, callId, localStream, localMuted, participants, iceServers, error, startCall, toggleMute, leaveCall } = useVoiceCall()
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setView = useAppStore((s) => s.setView)
  const qc = useQueryClient()

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  const voiceChannels = groups?.flatMap((g) =>
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
      await startCall({ callId: data.call.id, channelId })
      toast.success('Joined voice channel')
    },
    onError: () => toast.error('Failed to join voice'),
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Voice</h1>
          <p className="text-sm text-muted-foreground">
            Drop-in voice channels for hanging out. Uses Google STUN —{' '}
            {iceServers?.turnEnabled ? (
              <span className="text-green-600 font-medium">TURN enabled</span>
            ) : (
              <span className="text-yellow-600">TURN not configured (P2P only)</span>
            )}
          </p>
        </div>

        {/* Active call panel */}
        {status !== 'idle' && callId && (
          <Card className="p-6 border-2 border-primary/40">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">In call</div>
                <div className="text-lg font-semibold">{status === 'connecting' ? 'Connecting...' : 'Connected'}</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                {participants.size + 1} participant{participants.size === 0 ? '' : 's'}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {/* Local */}
              <ParticipantTile
                name="You"
                muted={localMuted}
                isLocal
                stream={localStream}
              />
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
                variant={localMuted ? 'destructive' : 'outline'}
                size="lg"
                onClick={toggleMute}
                className="rounded-full"
              >
                {localMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={leaveCall}
                className="rounded-full"
              >
                <PhoneOff className="w-5 h-5 mr-2" /> Leave
              </Button>
            </div>
            {error && <div className="text-sm text-red-500 text-center mt-2">{error}</div>}
          </Card>
        )}

        {/* Voice channels list */}
        {status === 'idle' && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
              Voice Channels
            </h2>
            {voiceChannels.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                No voice channels yet. Ask an admin to create one in a group.
              </div>
            ) : (
              <div className="space-y-2">
                {voiceChannels.map((ch: any) => {
                  const activeCall = activeCalls?.find((c) => c.channelId === ch.id)
                  const inCall = activeCall?.participants?.length || 0
                  return (
                    <div
                      key={ch.id}
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Volume2 className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{ch.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {ch.groupName} ·{' '}
                          {inCall > 0 ? (
                            <span className="text-green-600">{inCall} in call</span>
                          ) : (
                            'empty'
                          )}
                        </div>
                      </div>
                      {activeCall && (
                        <div className="flex -space-x-2">
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
                      <Button
                        size="sm"
                        onClick={() => startCallMutation.mutate(ch.id)}
                        disabled={startCallMutation.isPending}
                      >
                        {startCallMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Phone className="w-4 h-4 mr-1" /> Join
                          </>
                        )}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )}

        {/* Help card */}
        <Card className="p-4 bg-muted/30">
          <h3 className="text-sm font-semibold mb-2">About voice calls</h3>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Uses WebRTC peer-to-peer mesh — works great for 4-6 people.</li>
            <li>Always uses Google's free STUN server.</li>
            <li>
              If you fill in <code>CLOUDFLARE_TURN_KEY_ID</code> and <code>CLOUDFLARE_TURN_KEY_SECRET</code> in{' '}
              <code>.env</code>, TURN relay kicks in for users behind strict NATs.
            </li>
            <li>TURN credentials are generated server-side per call (never exposed in client code).</li>
          </ul>
        </Card>
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
    <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted/50">
      <div className="relative">
        <Avatar className="w-16 h-16">
          <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        {muted && (
          <div className="absolute -bottom-1 -right-1 bg-red-500 text-white rounded-full p-1">
            <MicOff className="w-3 h-3" />
          </div>
        )}
      </div>
      <div className="text-sm font-medium">
        {name} {isLocal && <span className="text-muted-foreground">(you)</span>}
      </div>
      {/* Hidden audio element to play remote stream */}
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

// Compact voice call start button (used inside chat header for DMs)
export function StartVoiceCallButton({ channelId }: { channelId: string }) {
  const { startCall } = useVoiceCall()
  const [pending, setPending] = useState(false)

  const handleStart = async () => {
    setPending(true)
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      })
      const data = await res.json()
      await startCall({ callId: data.call.id, channelId })
      useAppStore.getState().setView('voice')
    } catch {
      toast.error('Failed to start call')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={handleStart} disabled={pending} title="Start voice call">
      <Phone className="w-4 h-4" />
    </Button>
  )
}

// Used by chat view to expose the voice controls component elsewhere if needed
export const VoiceControls = { StartVoiceCallButton }
