'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSocket } from './useSocket'
import { useAppStore } from '@/stores/useAppStore'

export interface ChannelMessage {
  id: string
  channelId: string
  senderType: string
  senderId: string | null
  sender: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  } | null
  body: string
  mediaUrl: string | null
  mediaType: string | null
  replyToId: string | null
  replyTo: {
    id: string
    body: string
    senderType: string
    sender: { username: string; displayName: string } | null
  } | null
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
  readReceipts?: { userId: string }[]
}

interface TypingUser {
  userId: string
  username: string
  channelId: string
  isTyping: boolean
}

export function useChannel(channelId: string | null) {
  const { socket, connected } = useSocket()
  const qc = useQueryClient()
  const replyTo = useAppStore((s) => s.replyTo)
  const setReplyTo = useAppStore((s) => s.setReplyTo)

  // Subscribe to channel
  useEffect(() => {
    if (!socket || !connected || !channelId) return
    socket.emit('channel:join', channelId)
    return () => {
      socket.emit('channel:leave', channelId)
    }
  }, [socket, connected, channelId])

  // Listen for new messages
  useEffect(() => {
    if (!socket || !channelId) return
    const onMessage = (msg: ChannelMessage) => {
      if (msg.channelId !== channelId) return
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return [msg]
        if (old.some((m) => m.id === msg.id)) return old
        return [...old, msg]
      })
    }
    const onEdit = (msg: any) => {
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return old
        return old.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
      })
    }
    const onDelete = (payload: { messageId: string }) => {
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return old
        return old.map((m) =>
          m.id === payload.messageId ? { ...m, deletedAt: new Date().toISOString(), body: '', mediaUrl: null } : m
        )
      })
    }
    socket.on('channel:message', onMessage)
    socket.on('channel:message-edit', onEdit)
    socket.on('channel:message-delete', onDelete)
    return () => {
      socket.off('channel:message', onMessage)
      socket.off('channel:message-edit', onEdit)
      socket.off('channel:message-delete', onDelete)
    }
  }, [socket, channelId, qc])

  // Typing indicator
  const [typing, setTyping] = useState<Record<string, TypingUser>>({})
  useEffect(() => {
    if (!socket || !channelId) return
    const onTyping = (t: TypingUser) => {
      if (t.channelId !== channelId) return
      setTyping((prev) => {
        const next = { ...prev }
        if (t.isTyping) next[t.userId] = t
        else delete next[t.userId]
        return next
      })
      // auto-clear after 4s
      if (t.isTyping) {
        setTimeout(() => {
          setTyping((prev) => {
            if (prev[t.userId]?.username === t.username) {
              const n = { ...prev }
              delete n[t.userId]
              return n
            }
            return prev
          })
        }, 4000)
      }
    }
    socket.on('channel:typing', onTyping)
    return () => {
      socket.off('channel:typing', onTyping)
    }
  }, [socket, channelId])

  // Read receipts
  useEffect(() => {
    if (!socket || !channelId) return
    const onRead = (payload: { userId: string; channelId: string; messageId: string }) => {
      if (payload.channelId !== channelId) return
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return old
        return old.map((m) =>
          m.id === payload.messageId
            ? { ...m, readReceipts: [...(m.readReceipts || []), { userId: payload.userId }] }
            : m
        )
      })
    }
    socket.on('channel:read', onRead)
    return () => {
      socket.off('channel:read', onRead)
    }
  }, [socket, channelId, qc])

  // Fetch messages
  const { data, isLoading, error } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: async () => {
      if (!channelId) return []
      const res = await fetch(`/api/channels/${channelId}/messages?limit=50`)
      if (!res.ok) throw new Error('failed to load messages')
      const data = await res.json()
      return data.messages as ChannelMessage[]
    },
    enabled: !!channelId,
  })

  // Send message
  const sendMutation = useMutation({
    mutationFn: async (params: { body: string; replyToId?: string | null; mediaUrl?: string | null; mediaType?: string | null }) => {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('failed to send')
      return res.json()
    },
    onMutate: async (params) => {
      // Optimistic insert is omitted — the server-side bot dispatch may add
      // bot replies, so we let the socket event handle insertion.
      // The sent message itself is broadcast via socket by the same connection.
    },
    onSuccess: (data) => {
      // The message returned from the API may already be in the cache (if the
      // socket beat us). Ensure it's there.
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return [data.message]
        if (old.some((m) => m.id === data.message.id)) return old
        return [...old, data.message]
      })
      // Broadcast user message to other clients via socket — both the channel
      // event (so they see it in the open chat) AND a notify event (so they get
      // a badge/toast even if they're on a different screen).
      if (socket) {
        socket.emit('channel:message', { channelId, message: data.message })

        // Push a notification to every recipient (server-side fan-out via socket)
        if (data.recipientIds && Array.isArray(data.recipientIds)) {
          for (const recipientId of data.recipientIds) {
            socket.emit('notify:user', {
              userId: recipientId,
              type: 'message',
              data: {
                channelId,
                messageId: data.message.id,
                senderId: data.message.senderId,
                senderName: data.message.sender?.displayName || data.message.sender?.username,
                body: data.message.body,
                senderType: data.message.senderType,
              },
            })
          }
        }

        // Also broadcast any bot replies that were generated server-side
        if (data.botReplies && Array.isArray(data.botReplies)) {
          for (const reply of data.botReplies) {
            qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
              if (!old) return [reply]
              if (old.some((m) => m.id === reply.id)) return old
              return [...old, reply]
            })
            socket.emit('channel:message', { channelId, message: reply })
            // Notify recipients about the bot reply too
            if (data.recipientIds) {
              for (const recipientId of data.recipientIds) {
                socket.emit('notify:user', {
                  userId: recipientId,
                  type: 'message',
                  data: {
                    channelId,
                    messageId: reply.id,
                    senderId: reply.senderId,
                    senderName: reply.sender?.displayName || 'Bot',
                    body: reply.body,
                    senderType: 'bot',
                  },
                })
              }
            }
          }
        }
      }
      setReplyTo(null)
    },
  })

  // Edit message
  const editMutation = useMutation({
    mutationFn: async (params: { messageId: string; body: string }) => {
      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('failed to edit')
      return res.json()
    },
    onSuccess: (data) => {
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return old
        return old.map((m) => (m.id === data.message.id ? { ...m, ...data.message } : m))
      })
      if (socket) socket.emit('channel:message-edit', { channelId, message: data.message })
    },
  })

  // Delete message (soft)
  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await fetch(`/api/channels/${channelId}/messages?messageId=${messageId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed to delete')
      return res.json()
    },
    onSuccess: (data) => {
      const messageId = data.message.id
      qc.setQueryData(['messages', channelId], (old: ChannelMessage[] | undefined) => {
        if (!old) return old
        return old.map((m) => (m.id === messageId ? { ...m, deletedAt: data.message.deletedAt, body: '', mediaUrl: null } : m))
      })
      if (socket) socket.emit('channel:message-delete', { channelId, messageId })
    },
  })

  // Typing indicator broadcast (debounced)
  const lastTypingRef = useRef<number>(0)
  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !channelId) return
      const now = Date.now()
      if (isTyping && now - lastTypingRef.current < 1500) return
      lastTypingRef.current = now
      socket.emit('channel:typing', { channelId, isTyping })
    },
    [socket, channelId]
  )

  // Mark as read
  const markRead = useCallback(
    async (messageId: string) => {
      try {
        await fetch(`/api/channels/${channelId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId }),
        })
        if (socket) socket.emit('channel:read', { channelId, messageId })
      } catch (e) {
        // silent fail
      }
    },
    [channelId, socket]
  )

  return {
    messages: data || [],
    isLoading,
    error,
    send: sendMutation.mutateAsync,
    edit: editMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    typing: Object.values(typing),
    sendTyping,
    markRead,
    replyTo,
    setReplyTo,
  }
}
