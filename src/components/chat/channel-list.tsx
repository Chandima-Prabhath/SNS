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
import { Plus, Hash, Volume2, Users, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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
              <div className="flex items-center justify-between px-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  {g.iconUrl ? (
                    <img src={g.iconUrl} alt="" className="w-4 h-4 rounded" />
                  ) : (
                    <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-xs font-semibold uppercase tracking-wider truncate">
                    {g.name}
                  </span>
                </div>
                <InviteCodeButton code={g.inviteCode} />
              </div>
              {g.channels.map((ch) => {
                const active = ch.id === activeChannelId
                const Icon = ch.type === 'voice' ? Volume2 : Hash
                return (
                  <button
                    key={ch.id}
                    onClick={() => ch.type === 'text' && setActiveChannel(ch.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors',
                      'hover:bg-accent',
                      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{ch.name}</span>
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
      setView('chat')
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
