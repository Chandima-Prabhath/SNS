'use client'

import { create } from 'zustand'

export type ViewKey = 'chats' | 'status' | 'voice' | 'settings'

interface AppState {
  view: ViewKey
  setView: (v: ViewKey) => void

  activeChannelId: string | null
  setActiveChannel: (id: string | null) => void

  chatInfoOpen: boolean
  setChatInfoOpen: (open: boolean) => void

  replyTo: { id: string; body: string; senderName: string } | null
  setReplyTo: (r: { id: string; body: string; senderName: string } | null) => void

  chatFilter: 'all' | 'unread' | 'groups' | 'dms' | 'bots'
  setChatFilter: (f: AppState['chatFilter']) => void

  // Mobile sidebar
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
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

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}))
