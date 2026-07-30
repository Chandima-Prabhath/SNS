'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSocket } from './useSocket'
import { useTypingStore } from '@/stores/useTypingStore'

/**
 * Global typing indicator listener.
 *
 * The existing `useChannel` hook only listens for typing events on the
 * currently-active channel (it filters by `t.channelId !== channelId`). For
 * the chat list we need to know when *any* of the user's channels has active
 * typers — so this hook:
 *
 *   1. Listens for `channel:typing` events globally (no channelId filter).
 *   2. Updates the shared `useTypingStore` so the chat list can subscribe.
 *   3. Runs a 1s sweep to evict stale entries (a typist whose `isTyping:false`
 *      event was lost — e.g., they closed the tab mid-type — would otherwise
 *      linger forever).
 *
 * The server (`src/lib/realtime-server.ts`) fans `channel:typing` out to every
 * socket of every channel member via the in-memory presence map, so we receive
 * events for channels we haven't actively joined.
 *
 * Mount this once at the app root (alongside `useNotifications`) — it has no UI.
 */
export function useGlobalTyping() {
  const { socket, connected } = useSocket()
  const setTyping = useTypingStore((s) => s.setTyping)
  const clearTyping = useTypingStore((s) => s.clearTyping)

  // We don't actually need the channel list here — the server fans typing out
  // to all members regardless of which rooms the socket has joined. This query
  // is just kept for symmetry / future use (e.g., subscribing to per-channel
  // rooms for richer events).
  useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/channels')
      const data = await res.json()
      return data.groups as any[]
    },
  })

  // Listen for typing events globally
  useEffect(() => {
    if (!socket) return
    const onTyping = (t: {
      userId: string
      username: string
      channelId: string
      isTyping: boolean
    }) => {
      if (!t || !t.channelId) return
      if (t.isTyping) {
        setTyping(t.channelId, t.userId, t.username)
      } else {
        clearTyping(t.channelId, t.userId)
      }
    }
    socket.on('channel:typing', onTyping)
    return () => {
      socket.off('channel:typing', onTyping)
    }
  }, [socket, setTyping, clearTyping])

  // Periodic sweep — drop typers whose last pulse is older than 5s.
  // Typing events are debounced client-side to ~1.5s, so a healthy typist
  // refreshes well within this window. If we miss the `isTyping:false` event
  // (e.g., the typist's tab crashed), the sweep ensures the indicator
  // disappears within ~5s instead of sticking forever.
  useEffect(() => {
    const STALE_MS = 5000
    const interval = setInterval(() => {
      const state = useTypingStore.getState()
      const now = Date.now()
      for (const channelId of Object.keys(state.typingByChannel)) {
        const channelTyping = state.typingByChannel[channelId]
        for (const [userId, info] of Object.entries(channelTyping)) {
          if (now - info.lastUpdate > STALE_MS) {
            state.clearTyping(channelId, userId)
          }
        }
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Clear all typing state when the socket disconnects — otherwise the chat
  // list would show stale "typing..." indicators for users who went offline.
  useEffect(() => {
    if (!connected) {
      const state = useTypingStore.getState()
      for (const channelId of Object.keys(state.typingByChannel)) {
        state.clearChannel(channelId)
      }
    }
  }, [connected])
}
