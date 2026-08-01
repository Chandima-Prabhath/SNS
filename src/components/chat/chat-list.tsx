'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/useAppStore'
import { useTypingStore } from '@/stores/useTypingStore'
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
import { Plus, Hash, Volume2, Search, Users, Copy, Check, MessageCircle, Sparkles, LogIn, UserX, Settings, Crown, Shield, Video, Phone, Menu, Pin, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday } from 'date-fns'
import { GroupSettingsDialog } from './channel-list'
import { useCall } from '@/hooks/useCall'
import { unlockAudio } from '@/lib/call-manager'
import { useContextMenu } from '@/components/ui/context-menu-provider'
import { useConfirm } from '@/hooks/useConfirm'

interface ChannelInfo {
  id: string
  name: string
  topic: string | null
  type: string
  order: number
  lastMessage: {
    body: string
    mediaUrl: string | null
    mediaType: string | null
    senderName: string
    senderType: string
    senderId: string | null
    createdAt: string
  } | null
  lastMessageAt: string
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

  const { data: groups, isLoading: groupsLoading } = useQuery({
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
  const confirm = useConfirm()
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
        onClick: async () => {
          if (row.isDm) {
            const ok = await confirm({
              title: 'Delete conversation?',
              message: 'ALL messages will be permanently deleted for both users.',
              confirmLabel: 'Delete',
              variant: 'danger',
            })
            if (ok) {
              fetch(`/api/channels/${row.channel.id}`, {
                method: 'DELETE',
              }).then((res) => {
                if (!res.ok) throw new Error('Delete failed')
                qc.invalidateQueries({ queryKey: ['channels'] })
                if (activeChannelId === row.channel.id) setActiveChannel(null)
                toast.success('Conversation deleted')
              }).catch(() => toast.error('Failed to delete'))
            }
          } else {
            const ok = await confirm({
              title: `Leave #${row.channel.name}?`,
              confirmLabel: 'Leave',
              variant: 'danger',
            })
            if (ok) {
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
  //
  // Rows are sorted by most recent activity (lastMessageAt desc) so the
  // conversation with the newest message bubbles to the top. Channels with no
  // messages fall back to their creation timestamp — they sort to the bottom
  // of an active chat list but stay grouped above truly empty rows in a
  // brand-new account. Voice/video channels keep their original `order` and
  // are excluded from the activity sort (they have no messages).
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
    // Sort by most recent activity (descending). Voice/video channels without
    // a lastMessageAt fall back to channel.createdAt; they'll naturally sort
    // below active text channels.
    rows.sort((a, b) => {
      const aTime = a.channel.lastMessageAt
        ? new Date(a.channel.lastMessageAt).getTime()
        : 0
      const bTime = b.channel.lastMessageAt
        ? new Date(b.channel.lastMessageAt).getTime()
        : 0
      return bTime - aTime
    })
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
          {groupsLoading ? (
            <div className="space-y-1 p-1">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5">
                  <div className="w-10 h-10 rounded-full bg-muted/50 animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 rounded bg-muted/50 animate-pulse w-3/4" />
                    <div className="h-2.5 rounded bg-muted/30 animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredChats.length === 0 ? (
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
                    <ChatTextRow
                      key={row.channel.id}
                      row={row}
                      active={active}
                      partnerDeleted={partnerDeleted}
                      presenceStatus={presenceStatus}
                      unreadCount={unreadCount}
                      displayName={displayName}
                      myId={myId}
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
                    />
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

/**
 * Format a timestamp for the chat list row.
 *   - Today       → "HH:mm"   (e.g. "14:23")
 *   - Yesterday   → "Yesterday"
 *   - This year   → "MMM d"   (e.g. "Mar 5")
 *   - Older       → "MMM d, yyyy"
 *
 * Comparison is by calendar date (via date-fns `isToday`/`isYesterday` and
 * `getYear`), NOT raw epoch millis — so a message sent at 23:59 and viewed at
 * 00:01 correctly shows "Yesterday" instead of "00:01 today".
 */
function formatListTimestamp(dateStr: string | Date): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Yesterday'
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return format(d, 'MMM d')
  return format(d, 'MMM d, yyyy')
}

/**
 * Build the message preview text for a chat list row.
 *
 * Rules (matching common chat UX):
 *   - Media messages show a type label ("Photo", "Video", "Voice message",
 *     "File") — optionally with a caption if the message also has text.
 *   - Group channels prefix with the sender's name: "Sarah: lol that was
 *     wild". The current user's own messages show "You: ...".
 *   - DM channels with a bot partner prefix the bot's name on bot messages.
 *   - DM channels with another user show just the message body (the partner's
 *     name is already in the row title).
 *   - The result is truncated to ~40 chars to fit the row width.
 */
function getLastMessagePreview(
  row: ChatRow,
  myId: string | undefined
): string {
  const msg = row.channel.lastMessage
  if (!msg) {
    // Fall back to a sensible placeholder for empty channels
    if (row.isGroup) return row.groupName
    if (row.partner) return `@${row.partner.username}`
    return 'No messages yet'
  }

  // Determine the media label (if any)
  let mediaLabel = ''
  if (msg.mediaType?.startsWith('image')) mediaLabel = 'Photo'
  else if (msg.mediaType?.startsWith('video')) mediaLabel = 'Video'
  else if (msg.mediaType?.startsWith('audio')) mediaLabel = 'Voice message'
  else if (msg.mediaType === 'file') mediaLabel = 'File'
  else if (msg.mediaUrl && !msg.body) mediaLabel = 'File' // unknown media with no text

  const hasText = msg.body && msg.body.trim().length > 0
  // Combine media label + text body (e.g. "Photo: check this out")
  const textPart = hasText ? msg.body : ''
  const combined = mediaLabel
    ? hasText
      ? `${mediaLabel}: ${textPart}`
      : mediaLabel
    : textPart

  // Prefix with sender name where it adds context:
  //   - Group channels: always prefix (sender could be anyone)
  //   - DM with a bot partner: prefix bot name on bot messages (so the user
  //     can tell bot replies apart from their own messages)
  //   - DM with another user: no prefix needed (the row title is the partner)
  const isMyMessage = myId && msg.senderId === myId && msg.senderType === 'user'

  let prefixed: string
  if (row.isGroup) {
    const senderPrefix = isMyMessage ? 'You' : (msg.senderName || 'Someone')
    prefixed = `${senderPrefix}: ${combined}`
  } else if (msg.senderType === 'bot') {
    // DM with a bot — prefix the bot's name on bot replies
    prefixed = `${msg.senderName}: ${combined}`
  } else if (isMyMessage) {
    prefixed = `You: ${combined}`
  } else {
    prefixed = combined
  }

  // Truncate to ~40 chars for the row preview
  return prefixed.length > 40 ? prefixed.slice(0, 39) + '…' : prefixed
}

interface ChatTextRowProps {
  row: ChatRow
  active: boolean
  partnerDeleted: boolean
  presenceStatus: string
  unreadCount: number
  displayName: string
  myId: string | undefined
  onClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
}

/**
 * A single text-channel row in the chat list.
 *
 * Extracted into its own component so each row can subscribe to its own
 * typing state via `useTypingStore` without re-rendering every row on every
 * typing pulse. Zustand's selector-based subscription means a row only
 * re-renders when ITS channel's typing state changes.
 */
function ChatTextRow({
  row,
  active,
  partnerDeleted,
  presenceStatus,
  unreadCount,
  displayName,
  myId,
  onClick,
  onContextMenu,
  onTouchStart,
}: ChatTextRowProps) {
  // Subscribe to typing for THIS channel only. The selector returns a
  // primitive boolean so the row only re-renders when typing starts/stops.
  const isTyping = useTypingStore((s) => {
    const m = s.typingByChannel[row.channel.id]
    return !!m && Object.keys(m).length > 0
  })

  // When the channel is open, the in-chat typing indicator handles it —
  // don't replace the preview here. Only show "typing..." for channels the
  // user is NOT currently viewing.
  const showTyping = isTyping && !active

  const previewText = getLastMessagePreview(row, myId)
  const timestamp = row.channel.lastMessage
    ? formatListTimestamp(row.channel.lastMessage.createdAt)
    : ''

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
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

      {/* Name + preview + timestamp */}
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
          {timestamp && (
            <span
              className={cn(
                'shrink-0 text-[11px] tabular-nums',
                unreadCount > 0 ? 'text-primary font-medium' : 'text-muted-foreground'
              )}
            >
              {timestamp}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          {showTyping ? (
            <span className="text-xs truncate italic text-primary flex items-center gap-1 min-w-0">
              <span className="flex gap-0.5 shrink-0">
                <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
              </span>
              <span className="truncate">typing...</span>
            </span>
          ) : (
            <span
              className={cn(
                'text-xs truncate flex-1 min-w-0',
                unreadCount > 0 ? 'text-foreground/80 font-medium' : 'text-muted-foreground',
                partnerDeleted && 'italic'
              )}
            >
              {previewText}
            </span>
          )}
          {unreadCount > 0 && !active && (
            <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

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
  const [searchQuery, setSearchQuery] = useState('')
  const qc = useQueryClient()
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setView = useAppStore((s) => s.setView)
  const inFlightRef = useRef<Set<string>>(new Set())
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search — only fetches when the user stops typing for 200ms
  const { data: users } = useQuery({
    queryKey: ['users', searchQuery],
    queryFn: async () => {
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}&limit=20` : '?limit=20'
      const res = await fetch(`/api/users${params}`)
      const data = await res.json()
      return data.users as any[]
    },
  })

  const handleSearchChange = (value: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setSearchQuery(value), 200)
  }

  const startDm = useMutation({
    mutationFn: async (targetUserId: string) => {
      if (inFlightRef.current.has(targetUserId)) return null
      inFlightRef.current.add(targetUserId)
      try {
        const res = await fetch('/api/groups', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId }),
        })
        if (!res.ok) throw new Error('failed')
        return res.json()
      } finally {
        setTimeout(() => inFlightRef.current.delete(targetUserId), 1500)
      }
    },
    onSuccess: (data) => {
      if (!data) return
      qc.invalidateQueries({ queryKey: ['channels'] })
      setActiveChannel(data.channel.id)
      setOpen(false)
      setSearchQuery('')
      toast.success('DM started')
    },
    onError: () => {
      toast.error('Failed to start DM')
    },
  })

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearchQuery('') }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9">
          <Plus className="w-5 h-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>Search for someone to chat with privately.</DialogDescription>
        </DialogHeader>
        {/* Search input */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or username..."
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-80">
          <div className="space-y-1">
            {users?.length === 0 && (
              <div className="text-center text-sm text-muted-foreground p-4">
                {searchQuery ? `No users found for "${searchQuery}"` : 'No other users yet. Invite some friends!'}
              </div>
            )}
            {users?.map((u) => {
              const pending = startDm.isPending && startDm.variables === u.id
              return (
                <button
                  key={u.id}
                  onClick={() => startDm.mutate(u.id)}
                  disabled={startDm.isPending}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent text-left disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={u.avatarUrl || undefined} />
                    <AvatarFallback>{u.displayName?.charAt(0) || '?'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{u.displayName}</div>
                    <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                  </div>
                  {pending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
                </button>
              )
            })}
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
