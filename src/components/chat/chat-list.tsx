'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { useSession } from 'next-auth/react'
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
import { Plus, Hash, Volume2, Search, Users, Copy, Check, MessageCircle, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface ChannelInfo {
  id: string
  name: string
  topic: string | null
  type: string
  order: number
  partner?: {
    id: string
    displayName: string
    username: string
    avatarUrl: string | null
    status: string
  }
  group: {
    id: string
    name: string
    iconUrl: string | null
    isDm: boolean
    inviteCode: string
    ownerId: string
  }
}

interface ChatRow {
  channel: ChannelInfo
  isDm: boolean
  isGroup: boolean
  isBot: boolean
  partner?: ChannelInfo['partner']
  groupName: string
  groupIcon: string | null
}

export function ChatList() {
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const filter = useAppStore((s) => s.chatFilter)
  const setFilter = useAppStore((s) => s.setChatFilter)
  const presence = usePresence()
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id

  const [search, setSearch] = useState('')

  const { data: groups } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  // Auto-select first channel on desktop only (mobile shows the list first)
  useEffect(() => {
    if (!activeChannelId && groups && groups.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 1024) {
      const first = groups[0].channels.find((c: any) => c.type === 'text')
      if (first) setActiveChannel(first.id)
    }
  }, [activeChannelId, groups, setActiveChannel])

  // Flatten channels into a unified list of "chat rows"
  const allChats: ChatRow[] = useMemo(() => {
    if (!groups) return []
    const rows: ChatRow[] = []
    for (const g of groups) {
      for (const ch of g.channels) {
        if (ch.type !== 'text') continue
        rows.push({
          channel: ch,
          isDm: g.isDm,
          isGroup: !g.isDm,
          isBot: false,
          partner: g.partner, // populated by the API for DM groups
          groupName: g.name,
          groupIcon: g.iconUrl,
        })
      }
    }
    return rows
  }, [groups])

  // Apply filter
  const filteredChats = useMemo(() => {
    let list = allChats
    if (filter === 'dms') list = list.filter((c) => c.isDm)
    else if (filter === 'groups') list = list.filter((c) => c.isGroup)
    else if (filter === 'bots') list = list.filter((c) => c.isBot)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) =>
          c.channel.name.toLowerCase().includes(q) ||
          c.groupName.toLowerCase().includes(q) ||
          (c.partner?.displayName.toLowerCase().includes(q) ?? false) ||
          (c.partner?.username.toLowerCase().includes(q) ?? false)
      )
    }
    return list
  }, [allChats, filter, search])

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Chats</h1>
          <div className="flex gap-1">
            <NewDmButton />
            <CreateGroupButton />
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="pl-9 h-10 bg-background/50"
          />
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          {([
            ['all', 'All'],
            ['unread', 'Unread'],
            ['groups', 'Groups'],
            ['dms', 'Direct'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat list */}
      <ScrollArea className="flex-1">
        <div className="px-2 pb-4">
          {filteredChats.length === 0 ? (
            <EmptyChatList />
          ) : (
            <div className="space-y-0.5">
              {filteredChats.map((row) => {
                const active = row.channel.id === activeChannelId
                const presenceInfo = row.partner ? presence[row.partner.id] : null
                const presenceStatus = presenceInfo?.status || 'offline'
                return (
                  <button
                    key={row.channel.id}
                    onClick={() => setActiveChannel(row.channel.id)}
                    className={cn(
                      'w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left',
                      active ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                  >
                    {/* Avatar */}
                    {row.isGroup ? (
                      <div className="relative w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                        <Hash className="w-5 h-5 text-primary" />
                      </div>
                    ) : (
                      <div className="relative shrink-0">
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={row.partner?.avatarUrl || undefined} />
                          <AvatarFallback>
                            {row.partner?.displayName?.charAt(0) || row.channel.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className={cn(
                            'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-sidebar',
                            presenceStatus === 'online' && 'bg-status-online',
                            presenceStatus === 'idle' && 'bg-status-idle',
                            presenceStatus === 'dnd' && 'bg-status-dnd',
                            presenceStatus === 'offline' && 'bg-status-offline'
                          )}
                        />
                      </div>
                    )}

                    {/* Name + preview */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate text-[15px]">
                          {row.isGroup ? row.channel.name : row.partner?.displayName || row.channel.name}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {row.isGroup ? row.groupName : `@${row.partner?.username || 'user'}`}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function EmptyChatList() {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
        <MessageCircle className="w-7 h-7 text-primary" />
      </div>
      <h3 className="font-medium text-base">No chats yet</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
        Start a DM with a friend or create a group to get the conversation going.
      </p>
    </div>
  )
}

function CreateGroupButton() {
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
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Users className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a group</DialogTitle>
          <DialogDescription>
            Groups contain channels. You'll be the owner and can invite friends with the invite code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Group name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend Crew" />
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
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewDmButton() {
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
      toast.success('DM started')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Plus className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
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
                <Avatar className="w-10 h-10">
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
