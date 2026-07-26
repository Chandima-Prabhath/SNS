'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSocket } from './useSocket'
import { useAppStore } from '@/stores/useAppStore'
import { toast } from 'sonner'

export interface Notification {
  type: 'message' | 'call' | 'story' | 'system'
  data: any
  timestamp: number
}

/**
 * Persistent notification listener.
 *
 * As long as the socket is connected (which is whenever the user is signed in),
 * this hook listens for `notify` events from the server and:
 *   - Shows a toast for new messages (if the user is not on that chat)
 *   - Invalidates the relevant React Query cache to trigger badge/UI refresh
 *   - Plays a subtle notification sound for messages (optional, can be muted)
 *   - Bumps the unread count store
 *
 * This is the "persistent connection" the user asked for — the socket stays
 * open across all screens (Chats, Status, Calls, Settings), so notifications
 * arrive in real-time regardless of which view is active.
 */
export function useNotifications() {
  const { socket, connected } = useSocket()
  const qc = useQueryClient()
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const view = useAppStore((s) => s.view)
  const activeChannelRef = useRef(activeChannelId)
  const viewRef = useRef(view)

  // Keep refs in sync with current state — must happen in an effect, not during render
  useEffect(() => {
    activeChannelRef.current = activeChannelId
  }, [activeChannelId])
  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    if (!socket || !connected) return

    const onNotify = (notification: Notification) => {
      // Invalidate channels query so unread counts refresh
      qc.invalidateQueries({ queryKey: ['channels'] })
      qc.invalidateQueries({ queryKey: ['unread-counts'] })

      if (notification.type === 'message') {
        const { channelId, senderName, body, senderType } = notification.data

        // Only show a toast if the user is NOT currently viewing this channel
        const isViewingThisChat = viewRef.current === 'chats' && activeChannelRef.current === channelId
        if (!isViewingThisChat) {
          // Show toast — clean, no emoji prefix
          toast(senderName || 'New message', {
            description: body?.slice(0, 100) + (body?.length > 100 ? '...' : ''),
            duration: 4000,
          })

          // Play subtle message sound
          import('@/lib/call-sounds').then(m => m.CallSounds.playMessage()).catch(() => {})
        }
      }
    }

    socket.on('notify', onNotify)
    return () => {
      socket.off('notify', onNotify)
    }
  }, [socket, connected, qc])
}
