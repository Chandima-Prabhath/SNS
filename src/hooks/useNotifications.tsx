'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSocket } from './useSocket'
import { useAppStore } from '@/stores/useAppStore'
import { toast } from 'sonner'
import { MessageSquare, Phone, Video, AtSign, Bot } from 'lucide-react'

export interface Notification {
  type: 'message' | 'call' | 'story' | 'system' | 'mention'
  data: any
  timestamp: number
}

/**
 * Persistent notification listener.
 *
 * Listens for `notify` events from the server and shows rich toasts with:
 *   - Sender avatar + name
 *   - Channel/group context
 *   - Message preview
 *   - Click-to-open action
 *
 * Also invalidates React Query cache so unread counts refresh.
 */
export function useNotifications() {
  const { socket, connected } = useSocket()
  const qc = useQueryClient()
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const view = useAppStore((s) => s.view)
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const setView = useAppStore((s) => s.setView)
  const activeChannelRef = useRef(activeChannelId)
  const viewRef = useRef(view)

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

      if (notification.type === 'message' || notification.type === 'mention') {
        const {
          channelId,
          senderName,
          senderAvatar,
          senderType,
          body,
          channelName,
          groupName,
          isMention,
        } = notification.data

        // Only show a toast if the user is NOT currently viewing this channel
        const isViewingThisChat = viewRef.current === 'chats' && activeChannelRef.current === channelId
        if (isViewingThisChat) return

        // Build a rich toast with avatar + context
        const isBot = senderType === 'bot'
        const Icon = isMention ? AtSign : isBot ? Bot : MessageSquare

        toast.custom(
          () => (
            <button
              onClick={() => {
                setActiveChannel(channelId)
                setView('chats')
                toast.dismiss()
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 text-left hover:bg-accent/50 transition-colors shadow-lg"
            >
              {/* Avatar / icon */}
              {senderAvatar ? (
                <img
                  src={senderAvatar}
                  alt=""
                  className="w-10 h-10 rounded-full shrink-0 object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Icon className={isMention ? 'w-5 h-5 text-amber-400' : 'w-5 h-5 text-primary'} />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm truncate">{senderName || 'Unknown'}</span>
                  {isMention && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      Mention
                    </span>
                  )}
                </div>
                {groupName && channelName && groupName !== channelName && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {groupName} · #{channelName}
                  </div>
                )}
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {body?.slice(0, 100) + (body?.length > 100 ? '…' : '')}
                </div>
              </div>
            </button>
          ),
          { duration: 5000 }
        )

        // Play subtle message sound
        import('@/lib/call-sounds').then(m => m.CallSounds.playMessage()).catch(() => {})
      }

      if (notification.type === 'call') {
        const { callerName, callId, channelId, video } = notification.data
        const Icon = video ? Video : Phone

        toast.custom(
          () => (
            <button
              onClick={() => {
                setView('voice')
                toast.dismiss()
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-primary/30 text-left hover:bg-accent/50 transition-colors shadow-lg"
            >
              <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center shrink-0 shadow-glow">
                <Icon className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">
                  {video ? 'Video call' : 'Voice call'} from {callerName}
                </div>
                <div className="text-xs text-muted-foreground">
                  Tap to open
                </div>
              </div>
            </button>
          ),
          { duration: 8000 }
        )
      }
    }

    socket.on('notify', onNotify)
    return () => {
      socket.off('notify', onNotify)
    }
  }, [socket, connected, qc, setActiveChannel, setView])
}
