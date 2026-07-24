'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Shield, Users, Bot, Plus, Trash2, Server, Hash } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

export function AdminView() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">Manage users, channels, and bots.</p>
          </div>
        </div>

        <Tabs defaultValue="users">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
            <TabsTrigger value="users"><Users className="w-4 h-4 mr-1" /> Users</TabsTrigger>
            <TabsTrigger value="groups"><Hash className="w-4 h-4 mr-1" /> Groups</TabsTrigger>
            <TabsTrigger value="bots"><Bot className="w-4 h-4 mr-1" /> Bots</TabsTrigger>
            <TabsTrigger value="system"><Server className="w-4 h-4 mr-1" /> System</TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <UsersAdmin />
          </TabsContent>
          <TabsContent value="groups">
            <GroupsAdmin />
          </TabsContent>
          <TabsContent value="bots">
            <BotsAdmin />
          </TabsContent>
          <TabsContent value="system">
            <SystemAdmin />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function UsersAdmin() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('forbidden')
      return res.json()
    },
  })

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('Role updated')
    },
    onError: () => toast.error('Failed'),
  })

  if (isLoading) return <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>

  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground mb-3">
        {data?.users?.length || 0} users total. Change roles to grant or revoke admin access.
      </div>
      <div className="space-y-2">
        {data?.users?.map((u: any) => (
          <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg border">
            <Avatar className="w-9 h-9">
              <AvatarImage src={u.avatarUrl || undefined} />
              <AvatarFallback>{u.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {u.displayName}{' '}
                <span className="text-xs text-muted-foreground">@{u.username}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {u.email} · joined {format(new Date(u.createdAt), 'MMM d, yyyy')} · {u._count.messages} messages
              </div>
            </div>
            <Select
              value={u.role}
              onValueChange={(role) => updateRole.mutate({ userId: u.id, role })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">member</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="owner">owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </Card>
  )
}

function GroupsAdmin() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-groups'],
    queryFn: async () => {
      const res = await fetch('/api/admin/groups')
      if (!res.ok) throw new Error('forbidden')
      return res.json()
    },
  })

  const [newChannel, setNewChannel] = useState<{ groupId: string; name: string } | null>(null)

  const createChannel = useMutation({
    mutationFn: async ({ groupId, name }: { groupId: string; name: string }) => {
      const res = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, name }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-groups'] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Channel created')
      setNewChannel(null)
    },
    onError: () => toast.error('Failed'),
  })

  if (isLoading) return <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>

  return (
    <div className="space-y-4">
      {data?.groups?.map((g: any) => (
        <Card key={g.id} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold">{g.name}</div>
              <div className="text-xs text-muted-foreground">
                Owner: {g.owner.displayName} · {g._count.channels} channels
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNewChannel({ groupId: g.id, name: '' })}
            >
              <Plus className="w-3 h-3 mr-1" /> Add channel
            </Button>
          </div>

          {newChannel?.groupId === g.id && (
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="channel-name"
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newChannel.name.trim()) {
                    createChannel.mutate(newChannel)
                  }
                }}
              />
              <Button size="sm" onClick={() => createChannel.mutate(newChannel)} disabled={!newChannel.name.trim()}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewChannel(null)}>Cancel</Button>
            </div>
          )}

          <div className="space-y-1">
            {g.channels.map((ch: any) => (
              <div key={ch.id} className="flex items-center gap-2 text-sm p-2 rounded hover:bg-accent">
                <Badge variant="outline">{ch.type}</Badge>
                <span className="font-medium">{ch.name}</span>
                <span className="text-xs text-muted-foreground">
                  · {ch._count.members} members · {ch._count.messages} messages
                </span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function BotsAdmin() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-bots'],
    queryFn: async () => {
      const res = await fetch('/api/admin/bots')
      if (!res.ok) throw new Error('forbidden')
      return res.json()
    },
  })

  // Channel selection for adding a bot
  const [botToAssign, setBotToAssign] = useState<{ botId: string; channelId: string } | null>(null)
  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      return res.json()
    },
  })
  const allChannels = groups?.groups?.flatMap((g: any) =>
    g.channels.map((c: any) => ({ ...c, groupName: g.name }))
  ) || []

  const assignBot = useMutation({
    mutationFn: async ({ botId, channelId }: { botId: string; channelId: string }) => {
      const res = await fetch('/api/admin/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, channelId }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Bot added to channel')
      setBotToAssign(null)
    },
    onError: () => toast.error('Failed'),
  })

  if (isLoading) return <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>

  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground mb-3">
        {data?.bots?.length || 0} bots across all users. Add a bot to a channel so users can talk to it.
      </div>
      <div className="space-y-2">
        {data?.bots?.map((b: any) => (
          <div key={b.id} className="flex items-center gap-3 p-2 rounded-lg border">
            <Avatar className="w-9 h-9">
              <AvatarFallback><Bot className="w-4 h-4" /></AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {b.name} <span className="text-xs text-muted-foreground">@{b.username}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Module: {b.module} · Owner: {b.owner?.displayName || 'unknown'} · {b._count.sessions} active sessions
              </div>
            </div>
            <Badge variant={b.enabled ? 'default' : 'secondary'}>
              {b.enabled ? 'enabled' : 'disabled'}
            </Badge>
            <Select
              value=""
              onValueChange={(channelId) => assignBot.mutate({ botId: b.id, channelId })}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Add to channel..." />
              </SelectTrigger>
              <SelectContent>
                {allChannels
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.groupName} / {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SystemAdmin() {
  const [iceInfo, setIceInfo] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['ice-servers'],
    queryFn: async () => {
      const res = await fetch('/api/calls/ice-servers')
      return res.json()
    },
  })

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">WebRTC Configuration</h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">STUN server:</span>
              <code>{data?.stunUrl}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">TURN enabled:</span>
              {data?.turnEnabled ? (
                <Badge className="bg-green-500">Yes</Badge>
              ) : (
                <Badge variant="secondary">No</Badge>
              )}
            </div>
            {!data?.turnEnabled && (
              <div className="mt-3 p-3 bg-muted/50 rounded text-xs">
                <p className="font-medium mb-1">To enable Cloudflare TURN (free):</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Cloudflare Dashboard → Realtime &amp; Calls → Create TURN App</li>
                  <li>Copy the Key ID and Secret</li>
                  <li>
                    Add to <code>.env</code>:
                    <pre className="bg-muted p-2 mt-1 rounded">
{`CLOUDFLARE_TURN_KEY_ID=...
CLOUDFLARE_TURN_KEY_SECRET=...`}
                    </pre>
                  </li>
                  <li>Restart the server — credentials are auto-signed per call.</li>
                </ol>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Architecture</h3>
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            <strong>Realtime service:</strong> Socket.io mini-service on port 3003.
            Dumb relay for chat, presence, and WebRTC signaling — never carries media.
          </p>
          <p>
            <strong>Database:</strong> SQLite (file-based). For production with many
            users, swap <code>DATABASE_URL</code> in <code>.env</code> to a PostgreSQL
            URL and run <code>bun run db:push</code> again.
          </p>
          <p>
            <strong>Bot framework:</strong> Each bot is a module in{' '}
            <code>src/lib/bot/bots/</code>. Add a file, register in{' '}
            <code>src/lib/bot/index.ts</code>, and the dispatcher handles routing
            automatically.
          </p>
          <p>
            <strong>Voice calls:</strong> WebRTC mesh (P2P). For &gt;6 participants,
            consider swapping to an SFU like LiveKit or mediasoup — the signaling
            layer stays the same.
          </p>
        </div>
      </Card>
    </div>
  )
}
