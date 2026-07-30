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
import { Plus, Hash, Volume2, Search, Users, Copy, Check, MessageCircle, Sparkles, LogIn, UserX, Settings, Crown, Shield, Video, Phone, Menu, Pin, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { GroupSettingsDialog } from './channel-list'
import { useCall } from '@/hooks/useCall'
import { unlockAudio } from '@/lib/call-manager'
import { useContextMenu } from '@/components/ui/context-menu-provider'

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
  const setServerRailOpen = useAppStore((s) => s.setServerRailOpen)
  const ctxMenu = useContextMenu()
  const qc = useQueryClient()

  // Show a context menu for a chat row — supports right-click (desktop) and
  // long-press (mobile, via the custom touch handler).
  const showChatContextMenu = (e: React.MouseEvent | React.TouchEvent, row: ChatRow) => {
    let x: number, y: number
    if ('touches' in e) {
      const t = e.touches[0] || (e.changedTouches?.[0])
      if (!t) return
      x = t.clientX; y = t.clientY
    } else {
      x = e.clientX; y = e.clientY
    }
    if (!ctxMenu) return
    ctxMenu.show(x, y, [
      {
        label: 'Open',
        icon: <MessageCircle className="w-4 h-4" />,
        onClick: () => setActiveChannel(row.channel.id),
      },
      {
        label: 'Mark as read',
        icon: <Check className="w-4 h-4" />,
        onClick: () => {
          fetch(`/api/channels/${row.channel.id}/read`, { method: 'POST' }).then(() => {
            qc.invalidateQueries({ queryKey: ['unread-counts'] })
            qc.invalidateQueries({ queryKey: ['channels'] })
            toast.success('Marked as read')
          })
        },
      },
      {
        label: row.isDm ? 'Delete conversation' : 'Leave channel',
        icon: <Trash2 className="w-4 h-4" />,
        variant: 'danger',
        onClick: () => {
          if (row.isDm) {
            if (confirm('Delete this conversation? Messages will be removed for you.')) {
              // For DMs, we leave the channel membership
              fetch(`/api/channels/${row.channel.id}/members`, {
                method: 'DELETE',
              }).then(() => {
                qc.invalidateQueries({ queryKey: ['channels'] })
                if (activeChannelId === row.channel.id) setActiveChannel(null)
                toast.success('Conversation deleted')
              }).catch(() => toast.error('Failed to delete'))
            }
          } else {
            if (confirm(`Leave #${row.channel.name}?`)) {
              fetch(`/api/channels/${row.channel.id}/members`, {
                method: 'DELETE',
              }).then(() => {
                qc.invalidateQueries({ queryKey: ['channels'] })
                if (activeChannelId === row.channel.id) setActiveChannel(null)
                toast.success('Left channel')
              }).catch(() => toast.error('Failed to leave'))
            }
          }
        },
      },
    ])
  }

  // Join a voice/video channel — creates a call and switches to the voice view
  const setView = useAppStore((s) => s.setView)
  const { startCall } = useCall()
  const joinCallMutation = useMutation({
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
      setView('voice')
      toast.success('Joined channel')
    },
    onError: () => toast.error('Failed to join channel'),
  })

  // Auto-select first channel on desktop only (mobile shows the list first)
  useEffect(() => {
    if (!activeChannelId && groups && groups.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 1024) {
      const first = groups[0].channels.find((c: any) => c.type === 'text')
      if (first) setActiveChannel(first.id)
    }
  }, [activeChannelId, groups, setActiveChannel])

  // Flatten channels into a unified list of "chat rows"
  // When a server (non-DM group) is selected in the rail, show ALL channel
  // types (text, voice, video) for that group. When 'dm' is selected, only
  // show DM text channels.
  const allChats: ChatRow[] = useMemo(() => {
    if (!groups) return []
    const rows: ChatRow[] = []
    for (const g of groups) {
      // Filter by selected group from the server rail
      if (selectedGroupId === 'dm' && !g.isDm) continue
      if (selectedGroupId && selectedGroupId !== 'dm' && g.id !== selectedGroupId) continue
      for (const ch of g.channels) {
        // DMs only have text channels. Groups show all types.
        if (g.isDm && ch.type !== 'text') continue
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
    <div className="flex flex-col h-full w-full bg-sidebar/50 backdrop-blur-2xl">
      {/* Header — shows the selected group name or "Direct Messages" */}
      <div className="px-4 pt-4 pb-3 space-y-4 border-b border-white/5 bg-background/30 backdrop-blur-3xl shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Mobile: hamburger to open server rail drawer */}
            <button
              onClick={() => setServerRailOpen(true)}
              className="md:hidden w-9 h-9 rounded-xl bg-sidebar-accent flex items-center justify-center shrink-0 hover:bg-accent transition-colors active:scale-95"
              title="Groups & servers"
            >
              <Menu className="w-4 h-4" />
            </button>
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
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isViewingDms ? "Search DMs..." : "Search channels..."}
            className="pl-10 h-10 bg-black/20 border-white/10 focus-visible:ring-primary/30 rounded-xl shadow-inner transition-all"
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
            <EmptyChatList />
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

                  // Voice/video channels are rendered as "join" rows, not chat rows
                  const isCallChannel = row.channel.type === 'voice' || row.channel.type === 'video'
                  const CallIcon = row.channel.type === 'video' ? Video : Volume2

                  if (isCallChannel) {
                    return (
                      <button
                        key={row.channel.id}
                        onClick={() => joinCallMutation.mutate(row.channel.id)}
                        disabled={joinCallMutation.isPending}
                        className={cn(
                          'w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left group/call',
                          'hover:bg-accent/50 disabled:opacity-50'
                        )}
                      >
                        {/* Icon */}
                        <div className={cn(
                          'relative w-12 h-12 rounded-full flex items-center justify-center shrink-0',
                          row.channel.type === 'video'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-primary/15 text-primary'
                        )}>
                          <CallIcon className="w-5 h-5" />
                        </div>

                        {/* Name + status */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[15px] font-medium">
                              {row.channel.name}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                            <span className="capitalize">{row.channel.type} channel</span>
                            <span>·</span>
                            <span className="text-primary flex items-center gap-0.5">
                              <Phone className="w-3 h-3" />
                              Tap to join
                            </span>
                          </div>
                        </div>

                        {/* Join button */}
                        <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center shrink-0 group-hover/call:scale-110 transition-transform shadow-glow">
                          <Phone className="w-4 h-4 text-primary-foreground" />
                        </div>
                      </button>
                    )
                  }

                  return (
                    <button
                      key={row.channel.id}
                      onClick={() => setActiveChannel(row.channel.id)}
                      onContextMenu={(e) => { e.preventDefault(); showChatContextMenu(e, row) }}
                      onTouchStart={(e) => {
                        // Long-press detection for mobile
                        const touch = e.touches[0]
                        const timer = setTimeout(() => {
                          showChatContextMenu({
                            touches: [{ clientX: touch.clientX, clientY: touch.clientY }],
                          } as any, row)
                          // Trigger haptic feedback if available
                          if (navigator.vibrate) navigator.vibrate(50)
                        }, 500)
                        const cancel = () => clearTimeout(timer)
                        ;(e.currentTarget as HTMLElement).dataset.longPressTimer = String(timer)
                        // One-time listeners for cancellation
                        const el = e.currentTarget
                        const clear = () => {
                          cancel()
                          el.removeEventListener('touchend', clear)
                          el.removeEventListener('touchmove', clear)
                          el.removeEventListener('touchcancel', clear)
                        }
                        el.addEventListener('touchend', clear, { once: true })
                        el.addEventListener('touchmove', clear, { once: true })
                        el.addEventListener('touchcancel', clear, { once: true })
                      }}
                      className={cn(
                        'w-full flex items-center gap-3.5 p-3 rounded-2xl transition-all text-left select-none relative overflow-hidden',
                        active 
                          ? 'bg-primary/10 ring-1 ring-primary/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' 
                          : 'hover:bg-white/[0.04]'
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
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Discover section removed — users now start DMs from the NewDmButton in the
 * chat list header (the + icon next to the search bar).
 */

function EmptyChatList() {
  return (
    <div className="text-center py-20 px-6">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-4 ring-1 ring-primary/15">
        <MessageCircle className="w-9 h-9 text-primary" strokeWidth={1.5} />
      </div>
      <h3 className="font-semibold text-lg">No conversations yet</h3>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
        Start a DM with the + button, or create a group from the server rail.
      </p>
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
  const myRole = isOwner ? 'owner' : isAdmin ? 'admin' : 'member'

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
      {open && (
        <GroupSettingsDialog
          group={group}
          myRole={myRole}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
