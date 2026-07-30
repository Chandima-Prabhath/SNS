'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useChannel, type ChannelMessage } from '@/hooks/useChannel'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Reply, Edit2, Trash2, X, Check, Image as ImageIcon, Bot, UserX, Copy, Pin, AudioLines } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday } from 'date-fns'
import { useAppStore } from '@/stores/useAppStore'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { useContextMenu } from '@/components/ui/context-menu-provider'

interface MessageListProps {
  channelId: string
}

export function MessageList({ channelId }: MessageListProps) {
  const { messages, isLoading, send, edit, remove, typing, markRead, replyTo, setReplyTo } =
    useChannel(channelId)
  const { data: session } = useSession()
  const myId = (session?.user as any)?.id
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastMessageIdRef = useRef<string | null>(null)
  const isAtBottomRef = useRef(true)

  // Reset scroll state when switching channels — otherwise the auto-scroll
  // logic thinks we already saw the last message and skips the initial scroll.
  useEffect(() => {
    lastMessageIdRef.current = null
    isAtBottomRef.current = true
  }, [channelId])

  // Track whether the user is at the bottom of the scroll container.
  // We use a ref so the scroll handler doesn't trigger re-renders.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isAtBottomRef.current = distanceFromBottom < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll — handles BOTH the initial load (channel switch / first
  // messages arriving) and subsequent new messages.
  //
  // • Initial load: wait 200ms so avatars/images have time to render and
  //   lay out before we measure scrollHeight. Double rAF was too short for
  //   channels with media-heavy history (scroll would land on "yesterday"
  //   instead of the latest message).
  // • New message: use requestAnimationFrame so the DOM updates before we
  //   measure. Scroll smoothly so the user sees the message slide in.
  // • Own message: ALWAYS scroll, even if the user scrolled up (so sending
  //   a message snaps back to the bottom).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg) return
    // Already processed this exact message — nothing to do.
    if (lastMessageIdRef.current === lastMsg.id) return

    const isMine = lastMsg.senderId === myId
    const isInitialLoad = !lastMessageIdRef.current
    const shouldScroll = isInitialLoad || isMine || isAtBottomRef.current

    lastMessageIdRef.current = lastMsg.id
    markRead(lastMsg.id)

    if (!shouldScroll) return

    if (isInitialLoad) {
      // Give the browser time to lay out all the historical messages (and
      // their media) before we jump. 200ms is enough for most avatars and
      // thumbnails to load without making the channel switch feel slow.
      const t = window.setTimeout(() => {
        const e = scrollRef.current
        if (e) e.scrollTop = e.scrollHeight
      }, 200)
      return () => window.clearTimeout(t)
    }

    // New message — wait one frame so the new bubble has rendered before
    // we measure scrollHeight. Otherwise we'd scroll to the OLD bottom and
    // the latest message would sit just below the fold.
    const raf = requestAnimationFrame(() => {
      const e = scrollRef.current
      if (e) {
        e.scrollTo({ top: e.scrollHeight, behavior: 'smooth' })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [messages, myId, markRead])

  // Group consecutive messages by same sender within 5 min
  const grouped = useMemo(() => {
    const groups: ChannelMessage[][] = []
    let current: ChannelMessage[] = []
    for (const m of messages) {
      if (current.length === 0) {
        current.push(m)
      } else {
        const prev = current[current.length - 1]
        const sameSender = prev.senderId === m.senderId && prev.senderType === m.senderType
        const timeDiff = new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()
        if (sameSender && timeDiff < 5 * 60 * 1000) {
          current.push(m)
        } else {
          groups.push(current)
          current = [m]
        }
      }
    }
    if (current.length > 0) groups.push(current)
    return groups
  }, [messages])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background relative overflow-hidden">
      {/* Subtle cinematic glow in the background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(var(--primary),0.05),transparent)] pointer-events-none" />
      <div ref={scrollRef as any} className="flex-1 min-h-0 overflow-y-auto relative z-10 scroll-smooth">
        <div className="px-3 md:px-6 py-4 space-y-3 max-w-4xl mx-auto">
          {isLoading && <LoadingState />}

          {!isLoading && messages.length === 0 && (
            <div className="text-center py-20 px-4">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-primary/10 flex items-center justify-center mb-3 ring-1 ring-primary/15">
                <Reply className="w-7 h-7 text-primary" strokeWidth={1.5} />
              </div>
              <p className="text-base font-semibold">No messages yet</p>
              <p className="text-sm text-muted-foreground mt-1">Be the first to say hello</p>
            </div>
          )}

          {grouped.map((group, gi) => {
            const first = group[0]
            const isMine = first.senderId === myId && first.senderType === 'user'
            const isBot = first.senderType === 'bot'
            const senderDeleted = first.senderType === 'user' && !first.sender
            const senderName =
              first.senderType === 'bot'
                ? first.sender?.displayName || 'Bot'
                : first.sender?.displayName || (senderDeleted ? 'Deleted User' : 'Unknown')
            const dayLabel = formatDay(first.createdAt)
            const prevGroup = gi > 0 ? grouped[gi - 1] : null
            const showDayDivider = !prevGroup || formatDay(prevGroup[0].createdAt) !== dayLabel

            return (
              <div key={gi}>
                {showDayDivider && (
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground font-medium">{dayLabel}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <MessageGroup
                  group={group}
                  isMine={isMine}
                  isBot={isBot}
                  senderDeleted={senderDeleted}
                  senderName={senderName}
                  avatarUrl={first.sender?.avatarUrl || null}
                  myId={myId}
                  onReply={(m) =>
                    setReplyTo({ id: m.id, body: m.body, senderName })
                  }
                  onDelete={(m) => remove(m.id)}
                  onEditSubmit={async (messageId, text) => edit(messageId, text)}
                />
              </div>
            )
          })}

          {/* Typing indicator */}
          <AnimatePresence>
            {typing.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="flex items-center gap-2 text-xs text-muted-foreground italic px-2"
              >
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
                </span>
                {typing.map((t) => t.username).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing...
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2.5 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 bg-muted rounded" />
            <div className="h-4 w-3/4 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function formatDay(dateStr: string | Date) {
  const d = new Date(dateStr)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d, yyyy')
}

interface MessageGroupProps {
  group: ChannelMessage[]
  isMine: boolean
  isBot: boolean
  senderDeleted?: boolean
  senderName: string
  avatarUrl: string | null
  myId?: string
  onReply: (m: ChannelMessage) => void
  onDelete: (m: ChannelMessage) => void
  onEditSubmit: (messageId: string, text: string) => Promise<any>
}

function MessageGroup(props: MessageGroupProps) {
  const { group, isMine, isBot, senderDeleted, senderName, avatarUrl } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const replyTo = useAppStore((s) => s.replyTo)
  const setReplyTo = useAppStore((s) => s.setReplyTo)

  return (
    <div className="group/group flex gap-2.5">
      {/* Avatar — only show on first message of group, hidden for own messages on mobile */}
      <div className="w-8 shrink-0 pt-0.5">
        {isMine ? (
          <div className="w-8" />
        ) : senderDeleted ? (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <UserX className="w-4 h-4 text-muted-foreground" />
          </div>
        ) : (
          <Avatar className="w-9 h-9 shadow-sm ring-1 ring-white/10">
            <AvatarImage src={avatarUrl || undefined} />
            <AvatarFallback className={cn('text-xs font-semibold', isBot && 'bg-primary/20 text-primary')}>
              {isBot ? <Bot className="w-[18px] h-[18px]" /> : senderName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        {/* Sender name + time — only on first message of group */}
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={cn(
            'text-[13px] font-semibold',
            isBot && 'text-primary',
            isMine && 'text-foreground',
            senderDeleted && 'text-muted-foreground italic'
          )}>
            {isMine ? 'You' : senderName}
            {isBot && <span className="ml-1 text-[10px] uppercase font-bold text-primary/70">BOT</span>}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {format(new Date(group[0].createdAt), 'HH:mm')}
          </span>
        </div>

        {group.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            isMine={isMine}
            isLastOfGroup={i === group.length - 1}
            isEditing={editingId === m.id}
            setEditing={(v) => setEditingId(v ? m.id : null)}
            onReply={() => props.onReply(m)}
            onDelete={() => props.onDelete(m)}
            onEditSubmit={async (text) => {
              await props.onEditSubmit(m.id, text)
              setEditingId(null)
            }}
            highlight={replyTo?.id === m.id}
            clearHighlight={() => setReplyTo(null)}
          />
        ))}
      </div>
    </div>
  )
}

interface MessageItemProps {
  message: ChannelMessage
  isMine: boolean
  isLastOfGroup: boolean
  isEditing: boolean
  setEditing: (v: boolean) => void
  onReply: () => void
  onDelete: () => void
  onEditSubmit: (text: string) => Promise<void>
  highlight?: boolean
  clearHighlight: () => void
}

function MessageItem(props: MessageItemProps) {
  const { message: m, isMine, isLastOfGroup, isEditing, setEditing, onEditSubmit } = props
  const [editText, setEditText] = useState(m.body)
  const isDeleted = !!m.deletedAt
  const ctxMenu = useContextMenu()

  const showMessageContextMenu = (e: React.MouseEvent | React.TouchEvent) => {
    let x: number, y: number
    if ('touches' in e) {
      const t = e.touches[0] || (e.changedTouches?.[0])
      if (!t) return
      x = t.clientX; y = t.clientY
    } else {
      x = e.clientX; y = e.clientY
    }
    if (!ctxMenu) return
    const items: Array<{ label: string; icon: React.ReactNode; onClick: () => void; variant?: 'default' | 'danger' }> = [
      {
        label: 'Reply',
        icon: <Reply className="w-4 h-4" />,
        onClick: () => props.onReply(),
      },
      {
        label: 'Copy text',
        icon: <Copy className="w-4 h-4" />,
        onClick: () => {
          navigator.clipboard.writeText(m.body)
        },
      },
    ]
    if (isMine && !isEditing) {
      items.push({
        label: 'Edit',
        icon: <Edit2 className="w-4 h-4" />,
        onClick: () => setEditing(true),
      })
      items.push({
        label: 'Delete',
        icon: <Trash2 className="w-4 h-4" />,
        variant: 'danger',
        onClick: () => props.onDelete(),
      })
    }
    ctxMenu.show(x, y, items)
  }

  if (isDeleted) {
    return (
      <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
        <span className="text-xs text-muted-foreground italic px-3 py-1.5 rounded-2xl bg-muted/50">
          🚫 message deleted
        </span>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'group/msg relative flex items-end gap-1',
        isMine ? 'justify-end' : 'justify-start',
        props.highlight && 'ring-2 ring-primary/40 rounded-2xl',
        'transition-shadow'
      )}
      onClick={() => props.highlight && props.clearHighlight()}
    >
      {!isMine && <div className="w-8 shrink-0" />}

      {/* Message bubble */}
      <div
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showMessageContextMenu(e) }}
        onTouchStart={(e) => {
          // Long-press for mobile
          const touch = e.touches[0]
          const timer = setTimeout(() => {
            showMessageContextMenu({ touches: [{ clientX: touch.clientX, clientY: touch.clientY }] } as any)
            if (navigator.vibrate) navigator.vibrate(50)
          }, 500)
          const el = e.currentTarget
          const clear = () => {
            clearTimeout(timer)
            el.removeEventListener('touchend', clear)
            el.removeEventListener('touchmove', clear)
            el.removeEventListener('touchcancel', clear)
          }
          el.addEventListener('touchend', clear, { once: true })
          el.addEventListener('touchmove', clear, { once: true })
          el.addEventListener('touchcancel', clear, { once: true })
        }}
        className={cn(
          'relative max-w-[78%] md:max-w-[65%] px-4 py-2.5 text-[15px] leading-relaxed break-words select-none cursor-default backdrop-blur-md',
          isMine
            ? 'bg-gradient-to-br from-primary/90 to-primary text-primary-foreground rounded-[22px] rounded-br-sm shadow-[0_4px_12px_rgba(var(--primary),0.2)] border border-primary/20'
            : 'bg-black/30 text-foreground rounded-[22px] rounded-bl-sm shadow-sm border border-white/10',
          isLastOfGroup && 'mb-1.5'
        )}
      >
        {/* Reply context */}
        {m.replyTo && (
          <div className={cn(
            'border-l-2 pl-2 mb-1.5 text-xs opacity-80',
            isMine ? 'border-bubble-mine-foreground/40' : 'border-primary/40'
          )}>
            <div className="font-medium">
              {m.replyTo.senderType === 'bot'
                ? m.replyTo.sender?.displayName || 'Bot'
                : m.replyTo.sender?.displayName || 'Unknown'}
            </div>
            <div className="truncate opacity-70">{m.replyTo.body.slice(0, 80)}</div>
          </div>
        )}

        {/* Media */}
        {m.mediaUrl && m.mediaType?.startsWith('image') && (
          <img src={m.mediaUrl} alt="" className="rounded-lg mb-1.5 max-w-full -mx-1 w-[calc(100%+0.5rem)]" />
        )}
        {m.mediaUrl && m.mediaType?.startsWith('video') && (
          <video src={m.mediaUrl} controls className="rounded-lg mb-1.5 max-w-full -mx-1 w-[calc(100%+0.5rem)]" />
        )}
        {m.mediaUrl && m.mediaType?.startsWith('audio') && (
          <div className="mb-1.5 -mx-1">
            <div className={cn(
              'flex items-center gap-2 p-2 rounded-xl',
              isMine ? 'bg-black/15' : 'bg-black/20'
            )}>
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center shrink-0">
                <AudioLines className="w-4 h-4 text-primary-foreground" />
              </div>
              <audio controls src={m.mediaUrl} className="flex-1 h-8 min-w-0" style={{ maxWidth: '100%' }} />
            </div>
          </div>
        )}

        {/* Body or editor */}
        {isEditing ? (
          <div className="space-y-1.5">
            <textarea
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full bg-background/20 border border-background/30 rounded p-2 text-sm resize-none text-foreground placeholder:text-foreground/60"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onEditSubmit(editText)
                }
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7 text-xs" onClick={() => onEditSubmit(editText)}>
                <Check className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="whitespace-pre-wrap">{m.body}</div>
            {m.editedAt && (
              <span className={cn('text-[10px] opacity-60 ml-1')}>
                edited
              </span>
            )}
          </>
        )}
      </div>

      {/* Hover/tap actions */}
      {!isEditing && (
        <div
          className={cn(
            'opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity flex items-center',
            'bg-card/95 backdrop-blur-sm rounded-full shadow-sm border border-border/50',
            isMine ? 'order-first' : ''
          )}
        >
          <button onClick={props.onReply} className="p-1.5 hover:bg-accent rounded-full" title="Reply">
            <Reply className="w-3.5 h-3.5" />
          </button>
          {isMine && (
            <>
              <button onClick={() => setEditing(true)} className="p-1.5 hover:bg-accent rounded-full" title="Edit">
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={props.onDelete} className="p-1.5 hover:bg-accent text-red-500 rounded-full" title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </motion.div>
  )
}
