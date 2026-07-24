'use client'

import { create } from 'zustand'

export type ViewKey = 'chats' | 'status' | 'voice' | 'settings'

interface AppState {
  // Top-level destination (one of the bottom tabs on mobile / sidebar items on desktop)
  view: ViewKey
  setView: (v: ViewKey) => void

  // Active chat channel — when set, mobile shows full-screen chat
  activeChannelId: string | null
  setActiveChannel: (id: string | null) => void

  // Whether chat info panel is open (mobile: Sheet, desktop: right panel)
  chatInfoOpen: boolean
  setChatInfoOpen: (open: boolean) => void

  // Reply target
  replyTo: { id: string; body: string; senderName: string } | null
  setReplyTo: (r: { id: string; body: string; senderName: string } | null) => void

  // Chat list filter
  chatFilter: 'all' | 'unread' | 'groups' | 'dms' | 'bots'
  setChatFilter: (f: AppState['chatFilter']) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'chats',
  setView: (view) => set({ view }),

  activeChannelId: null,
  setActiveChannel: (id) => set({ activeChannelId: id, chatInfoOpen: false }),

  chatInfoOpen: false,
  setChatInfoOpen: (chatInfoOpen) => set({ chatInfoOpen }),

  replyTo: null,
  setReplyTo: (r) => set({ replyTo: r }),

  chatFilter: 'all',
  setChatFilter: (chatFilter) => set({ chatFilter }),
}))
