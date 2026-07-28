'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus, Hash, Volume2, Video, Users, Copy, Check, Settings, Phone, Radio,
  Shield, Crown, UserPlus, LogOut,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'

interface ChannelInfo {
  id: string
  name: string
  topic: string | null
  type: string
  order: number
  group: {
    id: string
    name: string
    iconUrl: string | null
    isDm: boolean
    inviteCode: string
    ownerId: string
  }
}

export function ChannelList() {
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setView = useAppStore((s) => s.setView)
  const presence = usePresence()
  const qc = useQueryClient()

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as Array<{
        id: string
        name: string
        iconUrl: string | null
        isDm: boolean
        inviteCode: string
        ownerId: string
        channels: ChannelInfo[]
      }>
    },
  })

  // Auto-select first text channel on first load
  useEffect(() => {
    if (!activeChannelId && groups && groups.length > 0) {
      const first = groups[0].channels.find((c) => c.type === 'text')
      if (first) setActiveChannel(first.id)
    }
  }, [activeChannelId, groups, setActiveChannel])

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <h2 className="font-semibold text-sm">Channels</h2>
        <CreateGroupButton />
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-4">
          {groups?.length === 0 && (
            <div className="text-center text-sm text-muted-foreground p-8 space-y-3">
              <p>No groups yet.</p>
              <CreateGroupButton variant="default" />
            </div>
          )}
          {groups?.map((g) => (
            <div key={g.id} className="space-y-1">
              <GroupHeader group={g} />
              {g.channels.map((ch) => {
                const active = ch.id === activeChannelId
                const Icon = ch.type === 'voice' ? Volume2 : ch.type === 'video' ? Video : Hash
                const isCallChannel = ch.type === 'voice' || ch.type === 'video'
                return (
                  <button
                    key={ch.id}
                    onClick={() => {
                      if (isCallChannel) {
                        // Voice/video channels jump to the Calls tab
                        setView('voice')
                      } else {
                        setActiveChannel(ch.id)
                      }
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors group/channel',
                      'hover:bg-accent',
                      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                      isCallChannel && 'hover:text-primary'
                    )}
                  >
                    <Icon
                      className={cn(
                        'w-4 h-4 shrink-0',
                        isCallChannel && 'text-primary/70 group-hover/channel:text-primary'
                      )}
                    />
                    <span className="truncate flex-1 text-left">{ch.name}</span>
                    {isCallChannel && (
                      <Phone className="w-3 h-3 opacity-0 group-hover/channel:opacity-100 transition-opacity text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Online users */}
      <div className="border-t p-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">
          Online — {Object.values(presence).filter((p) => p.status === 'online').length}
        </div>
        <ScrollArea className="max-h-32">
          <div className="space-y-0.5">
            {Object.values(presence)
              .filter((p) => p.status !== 'offline')
              .map((p) => (
                <div key={p.userId} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      p.status === 'online' && 'bg-green-500',
                      p.status === 'idle' && 'bg-yellow-500',
                      p.status === 'dnd' && 'bg-red-500'
                    )}
                  />
                  <span className="truncate">{p.username}</span>
                </div>
              ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

/**
 * Group header — shows the group name, invite code button, and a settings
 * dropdown for owners/admins to manage channels and members.
 */
function GroupHeader({ group }: { group: any }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id
  const isOwner = group.ownerId === myId

  // Check if I'm an admin via GroupMember
  const { data: myMembership } = useQuery({
    queryKey: ['my-membership', group.id],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${group.id}/members`)
      if (!res.ok) return null
      const data = await res.json()
      return data.members?.find((m: any) => m.userId === myId) || null
    },
    enabled: !!myId,
  })
  const isAdmin = myMembership?.role === 'admin'
  const canManage = isOwner || isAdmin

  return (
    <>
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-2 min-w-0">
          {group.iconUrl ? (
            <img src={group.iconUrl} alt="" className="w-4 h-4 rounded" />
          ) : (
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider truncate">
            {group.name}
          </span>
          {canManage && (
            <Crown className={cn('w-3 h-3', isOwner ? 'text-amber-400' : 'text-blue-400')} />
          )}
        </div>
        <div className="flex items-center gap-1">
          <InviteCodeButton code={group.inviteCode} />
          {canManage && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="opacity-50 hover:opacity-100 transition-opacity"
              title="Group settings"
            >
              <Settings className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {settingsOpen && canManage && (
        <GroupSettingsDialog
          group={group}
          myRole={isOwner ? 'owner' : 'admin'}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  )
}

function GroupSettingsDialog({
  group,
  myRole,
  onClose,
}: {
  group: any
  myRole: 'owner' | 'admin'
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'channels' | 'members'>('channels')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            {group.name}
          </DialogTitle>
          <DialogDescription>
            Manage channels and members. You are {myRole === 'owner' ? 'the owner' : 'an admin'}.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          <button
            onClick={() => setTab('channels')}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'channels' ? 'bg-background text-foreground' : 'text-muted-foreground'
            )}
          >
            Channels
          </button>
          <button
            onClick={() => setTab('members')}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              tab === 'members' ? 'bg-background text-foreground' : 'text-muted-foreground'
            )}
          >
            Members
          </button>
        </div>

        {tab === 'channels' ? (
          <ChannelsTab groupId={group.id} channels={group.channels} />
        ) : (
          <MembersTab groupId={group.id} myRole={myRole} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChannelsTab({ groupId, channels }: { groupId: string; channels: any[] }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<'text' | 'voice' | 'video'>('text')

  const createChannel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/groups/${groupId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Channel created')
      setName('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteChannel = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await fetch(`/api/channels/${channelId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Channel deleted')
    },
  })

  return (
    <div className="space-y-3">
      {/* Existing channels */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {channels.map((ch) => (
          <div
            key={ch.id}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50"
          >
            {ch.type === 'voice' ? (
              <Volume2 className="w-4 h-4 text-primary/70" />
            ) : ch.type === 'video' ? (
              <Video className="w-4 h-4 text-emerald-400" />
            ) : (
              <Hash className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="flex-1 text-sm truncate">{ch.name}</span>
            <button
              onClick={() => {
                if (confirm(`Delete #${ch.name}?`)) deleteChannel.mutate(ch.id)
              }}
              className="text-red-400 hover:text-red-300 text-xs"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {/* Create new channel */}
      <div className="border-t pt-3 space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Create Channel
        </Label>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="new-channel"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) createChannel.mutate()
            }}
          />
          <Select value={type} onValueChange={(v) => setType(v as any)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="voice">Voice</SelectItem>
              <SelectItem value="video">Video</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => createChannel.mutate()}
            disabled={!name.trim() || createChannel.isPending}
            size="icon"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Voice channels appear in the Calls tab. Video channels support video calls.
        </p>
      </div>
    </div>
  )
}

function MembersTab({ groupId, myRole }: { groupId: string; myRole: 'owner' | 'admin' }) {
  const qc = useQueryClient()
  const { data: members } = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${groupId}/members`)
      const data = await res.json()
      return data.members as any[]
    },
  })

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId, role }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-members', groupId] })
      qc.invalidateQueries({ queryKey: ['my-membership', groupId] })
      toast.success('Role updated')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const kickMember = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/groups/${groupId}/members?userId=${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'failed')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-members', groupId] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Member removed')
    },
    onError: (e: any) => toast.error(e.message),
  })

  if (!members) return <div className="text-sm text-muted-foreground p-4">Loading members…</div>

  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      {members.map((m) => {
        const isOwner = m.role === 'owner'
        const isAdmin = m.role === 'admin'
        return (
          <div
            key={m.userId}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50"
          >
            <Avatar className="w-8 h-8">
              <AvatarImage src={m.user?.avatarUrl || undefined} />
              <AvatarFallback>{m.user?.displayName?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate flex items-center gap-1.5">
                {m.user?.displayName || 'Unknown'}
                {isOwner && <Crown className="w-3 h-3 text-amber-400" />}
                {isAdmin && !isOwner && <Shield className="w-3 h-3 text-blue-400" />}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                @{m.user?.username} · {m.role}
              </div>
            </div>
            {/* Owner can promote/demote admins; admins can't manage roles */}
            {myRole === 'owner' && !isOwner && (
              <div className="flex items-center gap-1">
                {isAdmin ? (
                  <button
                    onClick={() => updateRole.mutate({ userId: m.userId, role: 'member' })}
                    className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent text-muted-foreground"
                  >
                    Demote
                  </button>
                ) : (
                  <button
                    onClick={() => updateRole.mutate({ userId: m.userId, role: 'admin' })}
                    className="text-xs px-2 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-400"
                  >
                    Promote
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Remove ${m.user?.displayName} from the group?`)) {
                      kickMember.mutate(m.userId)
                    }
                  }}
                  className="text-xs px-2 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-400"
                >
                  Kick
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
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
      className="opacity-50 hover:opacity-100 transition-opacity"
      title="Copy invite code"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

function CreateGroupButton({ variant = 'ghost' }: { variant?: 'ghost' | 'default' }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [channels, setChannels] = useState('general')
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          channels: channels.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Group created')
      setOpen(false)
      setName('')
      setChannels('general')
    },
    onError: () => toast.error('Failed to create group'),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === 'default' ? (
          <Button size="sm">Create a group</Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new group</DialogTitle>
          <DialogDescription>
            Groups contain channels. You'll become the owner and can invite friends via the invite code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekend Crew"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="group-channels">Channels (comma-separated)</Label>
            <Input
              id="group-channels"
              value={channels}
              onChange={(e) => setChannels(e.target.value)}
              placeholder="general, memes, planning"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function JoinGroupButton() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const qc = useQueryClient()

  const join = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Joined!')
      setOpen(false)
      setCode('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Join with code
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a group</DialogTitle>
          <DialogDescription>Enter the invite code your friend shared with you.</DialogDescription>
        </DialogHeader>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc123..." />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => join.mutate()} disabled={!code.trim() || join.isPending}>
            {join.isPending ? 'Joining...' : 'Join'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// DM list — start a DM with any user
export function StartDmButton() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setView = useAppStore((s) => s.setView)

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users')
      const data = await res.json()
      return data.users as any[]
    },
  })

  const startDm = useMutation({
    mutationFn: async (targetUserId: string) => {
      const res = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      setActiveChannel(data.channel.id)
      setOpen(false)
      setView('chats')
      toast.success('DM started')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Plus className="w-4 h-4 mr-2" />
          New DM
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a DM</DialogTitle>
          <DialogDescription>Pick someone to chat with privately.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <div className="space-y-1">
            {users?.length === 0 && (
              <div className="text-center text-sm text-muted-foreground p-4">
                No other users yet. Invite some friends!
              </div>
            )}
            {users?.map((u) => (
              <button
                key={u.id}
                onClick={() => startDm.mutate(u.id)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent text-left"
              >
                <Avatar className="w-9 h-9">
                  <AvatarImage src={u.avatarUrl || undefined} />
                  <AvatarFallback>{u.displayName?.charAt(0) || '?'}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{u.displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
