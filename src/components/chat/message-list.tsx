'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useChannel, type ChannelMessage } from '@/hooks/useChannel'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Reply, Edit2, Trash2, X, Check, Image as ImageIcon, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday } from 'date-fns'
import { useAppStore } from '@/stores/useAppStore'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'

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

  // Auto-scroll on new messages (only if user is near bottom)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg) return
    if (lastMessageIdRef.current !== lastMsg.id) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
      if (nearBottom || lastMsg.senderId === myId) {
        el.scrollTop = el.scrollHeight
      }
      lastMessageIdRef.current = lastMsg.id
      markRead(lastMsg.id)
    }
  }, [messages, myId, markRead])

  // Scroll to bottom when messages first load (e.g., opening a chat)
  useEffect(() => {
    if (messages.length > 0 && !lastMessageIdRef.current) {
      const el = scrollRef.current
      if (el) {
        // Use setTimeout to ensure DOM has rendered
        setTimeout(() => {
          el.scrollTop = el.scrollHeight
        }, 50)
      }
      lastMessageIdRef.current = messages[messages.length - 1].id
    }
  }, [messages])

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
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden">
      <div ref={scrollRef as any} className="flex-1 min-h-0 overflow-y-auto">
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
            const senderName =
              first.senderType === 'bot'
                ? first.sender?.displayName || 'Bot'
                : first.sender?.displayName || 'Unknown'
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
  senderName: string
  avatarUrl: string | null
  myId?: string
  onReply: (m: ChannelMessage) => void
  onDelete: (m: ChannelMessage) => void
  onEditSubmit: (messageId: string, text: string) => Promise<any>
}

function MessageGroup(props: MessageGroupProps) {
  const { group, isMine, isBot, senderName, avatarUrl } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const replyTo = useAppStore((s) => s.replyTo)
  const setReplyTo = useAppStore((s) => s.setReplyTo)

  return (
    <div className="group/group flex gap-2.5">
      {/* Avatar — only show on first message of group, hidden for own messages on mobile */}
      <div className="w-8 shrink-0 pt-0.5">
        {isMine ? (
          <div className="w-8" />
        ) : (
          <Avatar className="w-8 h-8">
            <AvatarImage src={avatarUrl || undefined} />
            <AvatarFallback className={cn('text-xs', isBot && 'bg-primary/15 text-primary')}>
              {isBot ? <Bot className="w-4 h-4" /> : senderName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        {/* Sender name + time — only on first message of group */}
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={cn('text-[13px] font-semibold', isBot && 'text-primary', isMine && 'text-foreground')}>
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
        className={cn(
          'relative max-w-[78%] md:max-w-[65%] px-3.5 py-2 text-[15px] leading-snug break-words',
          isMine
            ? 'bg-bubble-mine text-bubble-mine-foreground rounded-2xl rounded-br-md'
            : 'bg-bubble-other text-bubble-other-foreground rounded-2xl rounded-bl-md',
          isLastOfGroup && 'mb-1'
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
