'use client'

import { create } from 'zustand'

/**
 * Global typing indicator store.
 *
 * Tracks which channels have active typers, keyed by channelId → userId.
 * Each entry stores the typist's username and the timestamp of their most
 * recent typing pulse. A periodic sweep in `useGlobalTyping` evicts stale
 * entries (older than ~5s) so the UI doesn't get stuck showing "typing..."
 * after a user stops typing without sending an explicit stop event.
 */

interface TypingEntry {
  username: string
  lastUpdate: number
}

interface TypingStore {
  // channelId -> userId -> TypingEntry
  typingByChannel: Record<string, Record<string, TypingEntry>>
  setTyping: (channelId: string, userId: string, username: string) => void
  clearTyping: (channelId: string, userId: string) => void
  clearChannel: (channelId: string) => void
}

export const useTypingStore = create<TypingStore>((set) => ({
  typingByChannel: {},

  setTyping: (channelId, userId, username) =>
    set((state) => {
      const channelTyping = state.typingByChannel[channelId] || {}
      return {
        typingByChannel: {
          ...state.typingByChannel,
          [channelId]: {
            ...channelTyping,
            [userId]: { username, lastUpdate: Date.now() },
          },
        },
      }
    }),

  clearTyping: (channelId, userId) =>
    set((state) => {
      const channelTyping = state.typingByChannel[channelId]
      if (!channelTyping || !channelTyping[userId]) return state
      const next = { ...channelTyping }
      delete next[userId]
      // Drop the channel entry entirely when empty so the chat list's
      // `Object.keys(...).length > 0` check stays cheap and clean.
      const nextByChannel = { ...state.typingByChannel }
      if (Object.keys(next).length === 0) {
        delete nextByChannel[channelId]
      } else {
        nextByChannel[channelId] = next
      }
      return { typingByChannel: nextByChannel }
    }),

  clearChannel: (channelId) =>
    set((state) => {
      if (!state.typingByChannel[channelId]) return state
      const next = { ...state.typingByChannel }
      delete next[channelId]
      return { typingByChannel: next }
    }),
}))

/**
 * Selector helper: returns the list of typers for a channel, or an empty
 * array. Memoized by reference equality when the underlying state is unchanged.
 */
export function selectTypers(channelId: string) {
  return (state: TypingStore): TypingEntry[] => {
    const m = state.typingByChannel[channelId]
    if (!m) return []
    return Object.values(m)
  }
}
