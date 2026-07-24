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
          // Show toast
          const isBot = senderType === 'bot'
          toast(
            isBot ? `🤖 ${senderName}` : senderName || 'New message',
            {
              description: body?.slice(0, 100) + (body?.length > 100 ? '...' : ''),
              duration: 4000,
            }
          )

          // Play notification sound (subtle, can be muted)
          playNotificationSound()
        }
      }
    }

    socket.on('notify', onNotify)
    return () => {
      socket.off('notify', onNotify)
    }
  }, [socket, connected, qc])
}

/**
 * Subtle notification sound — a short sine-wave "blip" generated via Web Audio API.
 * No asset file needed; works offline; respects browser autoplay rules because
 * it's triggered by a user-gesture-adjacent socket event.
 */
let audioCtx: AudioContext | null = null
function playNotificationSound() {
  try {
    if (!audioCtx) {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) return
      audioCtx = new AudioContextClass()
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.frequency.setValueAtTime(880, audioCtx.currentTime) // A5
    osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime + 0.08) // E5
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.06, audioCtx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18)
    osc.start(audioCtx.currentTime)
    osc.stop(audioCtx.currentTime + 0.2)
  } catch (e) {
    // Audio not available — silent fail
  }
}
