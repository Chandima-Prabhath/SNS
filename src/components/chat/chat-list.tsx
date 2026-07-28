'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { usePresence } from '@/hooks/usePresence'
import { useUnreadCounts } from '@/hooks/useUnreadCounts'
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
import { Plus, Hash, Volume2, Search, Users, Copy, Check, MessageCircle, Sparkles, LogIn, UserX, Settings, Crown, Shield, Video, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { GroupSettingsDialog } from './channel-list'

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
  const selectedGroupId = useAppStore((s) => s.selectedGroupId)
  const filter = useAppStore((s) => s.chatFilter)
  const setFilter = useAppStore((s) => s.setChatFilter)
  const presence = usePresence()
  const { data: unreadData } = useUnreadCounts()
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

  // The currently selected group object (or null for DMs)
  const selectedGroup = groups?.find((g) => g.id === selectedGroupId) || null
  const isViewingDms = selectedGroupId === 'dm'

  // Fetch all users for the "Discover people" section
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users')
      const data = await res.json()
      return data.users as any[]
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
  // When a server (non-DM group) is selected in the rail, only show that
  // group's channels. When 'dm' is selected, only show DM channels.
  const allChats: ChatRow[] = useMemo(() => {
    if (!groups) return []
    const rows: ChatRow[] = []
    for (const g of groups) {
      // Filter by selected group from the server rail
      if (selectedGroupId === 'dm' && !g.isDm) continue
      if (selectedGroupId && selectedGroupId !== 'dm' && g.id !== selectedGroupId) continue
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
  }, [groups, selectedGroupId])

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
    <div className="flex flex-col h-full w-full bg-sidebar">
      {/* Header — shows the selected group name or "Direct Messages" */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-sidebar-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {isViewingDms ? (
              <>
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight truncate">Direct Messages</h1>
                  <p className="text-[11px] text-muted-foreground">Private conversations</p>
                </div>
              </>
            ) : selectedGroup ? (
              <>
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0 overflow-hidden">
                  {selectedGroup.iconUrl ? (
                    <img src={selectedGroup.iconUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Users className="w-4 h-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight truncate">{selectedGroup.name}</h1>
                  {selectedGroup.description && (
                    <p className="text-[11px] text-muted-foreground truncate">{selectedGroup.description}</p>
                  )}
                </div>
              </>
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">Chats</h1>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {isViewingDms && <NewDmButton />}
            {!isViewingDms && selectedGroup && <GroupSettingsButton group={selectedGroup} />}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isViewingDms ? "Search DMs..." : "Search channels..."}
            className="pl-9 h-10 bg-background/50"
          />
        </div>

        {/* Filter chips — only show for DMs */}
        {isViewingDms && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
            {([
              ['all', 'All'],
              ['unread', 'Unread'],
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
        )}
      </div>

      {/* Chat list */}
      <ScrollArea className="flex-1">
        <div className="px-2 pb-4">
          {filteredChats.length === 0 ? (
            <EmptyChatList hasUsers={!!(users && users.length > 0)} />
          ) : (
            <>
              <div className="space-y-0.5">
                {filteredChats.map((row) => {
                  const active = row.channel.id === activeChannelId
                  // A DM partner may have been deleted — detect and show a
                  // graceful "Deleted User" label instead of @user fallback.
                  const partnerDeleted = !row.isGroup && !row.partner
                  const presenceInfo = row.partner ? presence[row.partner.id] : null
                  const presenceStatus = presenceInfo?.status || 'offline'
                  const unreadCount = unreadData?.unread?.[row.channel.id] || 0
                  const displayName = row.isGroup
                    ? row.channel.name
                    : row.partner?.displayName || 'Deleted User'
                  const handleText = row.isGroup
                    ? row.groupName
                    : row.partner ? `@${row.partner.username}` : 'account no longer exists'
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
                      ) : partnerDeleted ? (
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                            <UserX className="w-5 h-5" />
                          </div>
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
                          <span
                            className={cn(
                              'truncate text-[15px]',
                              unreadCount > 0 ? 'font-semibold text-foreground' : 'font-medium',
                              partnerDeleted && 'text-muted-foreground italic'
                            )}
                          >
                            {displayName}
                          </span>
                          {unreadCount > 0 && !active && (
                            <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                        </div>
                        <div
                          className={cn(
                            'text-xs truncate',
                            unreadCount > 0 ? 'text-foreground/80 font-medium' : 'text-muted-foreground',
                            partnerDeleted && 'italic'
                          )}
                        >
                          {handleText}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Discover people to DM — only shown when not searching and filter is 'all' */}
              {filter === 'all' && !search.trim() && users && users.length > 0 && (
                <DiscoverPeople users={users} existingDmPartnerIds={filteredChats.filter(c => c.isDm).map(c => c.partner?.id).filter(Boolean)} />
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Discover section — shows all users you can DM but haven't yet.
 * Helps first-time users find people to talk to without hunting for the + button.
 */
function DiscoverPeople({ users, existingDmPartnerIds }: { users: any[]; existingDmPartnerIds: string[] }) {
  const qc = useQueryClient()
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)

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
      toast.success('DM started')
    },
  })

  // Filter out users we already have a DM with
  const newUsers = users.filter((u) => !existingDmPartnerIds.includes(u.id))
  if (newUsers.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">
        Discover people
      </h3>
      <div className="space-y-0.5">
        {newUsers.map((u) => (
          <button
            key={u.id}
            onClick={() => startDm.mutate(u.id)}
            className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-accent/50 transition-colors text-left"
          >
            <div className="relative shrink-0">
              <Avatar className="w-11 h-11">
                <AvatarImage src={u.avatarUrl || undefined} />
                <AvatarFallback>{u.displayName?.charAt(0) || '?'}</AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-sidebar',
                  u.status === 'online' && 'bg-status-online',
                  u.status === 'idle' && 'bg-status-idle',
                  u.status === 'dnd' && 'bg-status-dnd',
                  u.status === 'offline' && 'bg-status-offline'
                )}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[15px] truncate">{u.displayName}</div>
              <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
            </div>
            <span className="text-xs text-primary font-medium shrink-0">Message</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function EmptyChatList({ hasUsers }: { hasUsers: boolean }) {
  return (
    <div className="text-center py-20 px-6">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-4 ring-1 ring-primary/15">
        <MessageCircle className="w-9 h-9 text-primary" strokeWidth={1.5} />
      </div>
      <h3 className="font-semibold text-lg">Welcome to Adoo</h3>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
        {hasUsers
          ? 'No conversations yet. Tap someone below to start chatting, or create a group with the + button.'
          : 'You\'re the first one here! Invite your friends — tap the + button and share the invite code.'}
      </p>
      {!hasUsers && (
        <div className="mt-4 inline-flex items-center gap-2 text-xs text-primary bg-primary/10 px-3 py-1.5 rounded-full">
          <MessageCircle className="w-3.5 h-3.5" />
          Share invite code from any channel
        </div>
      )}
    </div>
  )
}

function JoinGroupButton() {
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
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Invalid invite code')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      toast.success('Joined group')
      setOpen(false)
      setCode('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" title="Join group">
          <LogIn className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a group</DialogTitle>
          <DialogDescription>Enter the invite code your friend shared with you.</DialogDescription>
        </DialogHeader>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste invite code..."
          autoCapitalize="none"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => join.mutate()} disabled={!code.trim() || join.isPending}>
            {join.isPending ? 'Joining...' : 'Join'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/**
 * Group settings button — opens the GroupSettingsDialog for the currently
 * selected group. Shows a Crown for owners and Shield for admins.
 */
function GroupSettingsButton({ group }: { group: any }) {
  const [open, setOpen] = useState(false)
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id
  const isOwner = group.ownerId === myId

  // Check if I'm an admin via the members API
  const { data: myMembership } = useQuery({
    queryKey: ['my-membership', group.id],
    queryFn: async () => {
      const res = await fetch(`/api/groups/${group.id}/members`)
      if (!res.ok) return null
      const data = await res.json()
      return data.members?.find((m: any) => m.userId === myId) || null
    },
    enabled: !!myId && open,
  })
  const isAdmin = myMembership?.role === 'admin'
  const canManage = isOwner || isAdmin

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => setOpen(true)}
        title="Group settings"
      >
        <Settings className="w-4 h-4" />
      </Button>
      {open && canManage && (
        <GroupSettingsDialog
          group={group}
          myRole={isOwner ? 'owner' : 'admin'}
          onClose={() => setOpen(false)}
        />
      )}
      {open && !canManage && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{group.name}</DialogTitle>
              <DialogDescription>You are a member of this group. Only owners and admins can manage channels and members.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
              <Copy className="w-4 h-4 text-muted-foreground" />
              <Input
                readOnly
                value={group.inviteCode}
                className="flex-1 bg-transparent border-0 focus-visible:ring-0"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(group.inviteCode)
                  toast.success('Invite code copied')
                }}
              >
                Copy
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
