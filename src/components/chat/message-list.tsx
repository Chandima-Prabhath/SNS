'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useChannel, type ChannelMessage } from '@/hooks/useChannel'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Reply, Edit2, Trash2, X, Check, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday } from 'date-fns'
import { useAppStore } from '@/stores/useAppStore'
import { useSession } from 'next-auth/react'

interface MessageListProps {
  channelId: string
}

export function MessageList({ channelId }: MessageListProps) {
  const {
    messages,
    isLoading,
    send,
    edit,
    remove,
    typing,
    markRead,
    replyTo,
    setReplyTo,
  } = useChannel(channelId)
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
      // Mark as read
      markRead(lastMsg.id)
    }
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
    <div className="flex-1 flex flex-col min-h-0">
      <ScrollArea className="flex-1" ref={scrollRef as any}>
        <div className="p-4 space-y-4">
          {isLoading && (
            <div className="text-center text-sm text-muted-foreground py-8">Loading messages...</div>
          )}
          {!isLoading && messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              <p>No messages yet.</p>
              <p className="text-xs mt-1">Say hello 👋</p>
            </div>
          )}
          {grouped.map((group, gi) => {
            const first = group[0]
            const senderName =
              first.senderType === 'bot'
                ? `🤖 ${first.sender?.displayName || 'Bot'}`
                : first.sender?.displayName || 'Unknown'
            const senderUsername = first.sender?.username || ''
            const isMine = first.senderId === myId && first.senderType === 'user'
            const isBot = first.senderType === 'bot'
            const dayLabel = formatDay(first.createdAt)
            const prevGroup = gi > 0 ? grouped[gi - 1] : null
            const showDayDivider = !prevGroup || formatDay(prevGroup[0].createdAt) !== dayLabel

            return (
              <div key={gi}>
                {showDayDivider && (
                  <div className="flex items-center gap-2 my-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">{dayLabel}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                <MessageGroup
                  group={group}
                  senderName={senderName}
                  senderUsername={senderUsername}
                  avatarUrl={first.sender?.avatarUrl || null}
                  isMine={isMine}
                  isBot={isBot}
                  myId={myId}
                  onReply={(m) =>
                    setReplyTo({
                      id: m.id,
                      body: m.body,
                      senderName,
                    })
                  }
                  onDelete={(m) => remove(m.id)}
                  onEditSubmit={(messageId, text) =>
                    edit(messageId, text)
                  }
                />
              </div>
            )
          })}
          {typing.length > 0 && (
            <div className="text-xs text-muted-foreground italic px-2">
              {typing.map((t) => t.username).join(', ')} {typing.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}
        </div>
      </ScrollArea>
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
  senderName: string
  senderUsername: string
  avatarUrl: string | null
  isMine: boolean
  isBot: boolean
  myId?: string
  onReply: (m: ChannelMessage) => void
  onDelete: (m: ChannelMessage) => void
  onEditSubmit: (messageId: string, text: string) => Promise<any>
}

function MessageGroup(props: MessageGroupProps) {
  const { group, senderName, avatarUrl, isMine, isBot } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const replyTo = useAppStore((s) => s.replyTo)
  const setReplyTo = useAppStore((s) => s.setReplyTo)

  return (
    <div className="group/group flex gap-3">
      <Avatar className="w-9 h-9 shrink-0 mt-0.5">
        <AvatarImage src={avatarUrl || undefined} />
        <AvatarFallback className={cn(isBot && 'bg-primary/10 text-primary')}>
          {senderName.replace('🤖 ', '').charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className={cn('text-sm font-medium', isBot && 'text-primary')}>{senderName}</span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(group[0].createdAt), 'HH:mm')}
          </span>
        </div>
        {group.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isMine={isMine}
            isEditing={editingId === m.id}
            setEditing={(v) => setEditingId(v ? m.id : null)}
            onReply={() => props.onReply(m)}
            onDelete={() => props.onDelete(m)}
            onEditSubmit={async (text) => {
              await props.onEditSubmit(m.id, text)
              setEditingId(null)
            }}
            replyToBody={replyTo?.id === m.replyToId ? replyTo.body : undefined}
            highlight={replyTo?.id === m.id}
            clearHighlight={() => setReplyTo(null)}
            myId={props.myId}
          />
        ))}
      </div>
    </div>
  )
}

interface MessageItemProps {
  message: ChannelMessage
  isMine: boolean
  isEditing: boolean
  setEditing: (v: boolean) => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onEditSubmit: (text: string) => void
  replyToBody?: string
  highlight?: boolean
  clearHighlight: () => void
  myId?: string
}

function MessageItem(props: MessageItemProps) {
  const { message: m, isMine, isEditing, setEditing, onEditSubmit } = props
  const [editText, setEditText] = useState(m.body)
  const isDeleted = !!m.deletedAt

  const readerCount = m.readReceipts?.length || 0
  const showReadReceipt = isMine && readerCount > 0 && !isDeleted

  if (isDeleted) {
    return (
      <div className="text-xs text-muted-foreground italic py-1">
        🚫 message deleted
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group/msg relative py-0.5 px-1 -mx-1 rounded transition-colors',
        props.highlight && 'bg-yellow-500/10',
        'hover:bg-accent/50'
      )}
      onClick={() => props.highlight && props.clearHighlight()}
    >
      {m.replyTo && (
        <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 mb-1">
          <span className="font-medium">
            {m.replyTo.senderType === 'bot'
              ? `🤖 ${m.replyTo.sender?.displayName || 'Bot'}`
              : m.replyTo.sender?.displayName || 'Unknown'}
            :
          </span>{' '}
          {m.replyTo.body.slice(0, 100)}
          {m.replyTo.body.length > 100 && '...'}
        </div>
      )}
      {m.mediaUrl && m.mediaType?.startsWith('image') && (
        <img src={m.mediaUrl} alt="" className="max-w-sm rounded-lg mb-1" />
      )}
      {m.mediaUrl && m.mediaType?.startsWith('video') && (
        <video src={m.mediaUrl} controls className="max-w-sm rounded-lg mb-1" />
      )}
      {isEditing ? (
        <div className="space-y-1">
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full bg-background border rounded p-2 text-sm resize-none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onEditSubmit(editText)
              }
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onEditSubmit(editText)}>
              <Check className="w-3 h-3 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X className="w-3 h-3 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap break-words">
          {m.body}
          {m.editedAt && <span className="text-xs text-muted-foreground ml-1">(edited)</span>}
        </div>
      )}
      {showReadReceipt && (
        <div className="text-xs text-muted-foreground">
          {readerCount === 1 ? 'read' : `read by ${readerCount}`}
        </div>
      )}
      {/* Hover actions */}
      <div className="absolute -top-3 right-2 opacity-0 group-hover/msg:opacity-100 transition-opacity flex bg-card border rounded shadow-sm">
        <button
          onClick={props.onReply}
          className="p-1 hover:bg-accent"
          title="Reply"
        >
          <Reply className="w-3 h-3" />
        </button>
        {isMine && (
          <>
            <button
              onClick={() => setEditing(true)}
              className="p-1 hover:bg-accent"
              title="Edit"
            >
              <Edit2 className="w-3 h-3" />
            </button>
            <button
              onClick={props.onDelete}
              className="p-1 hover:bg-accent text-red-600"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
