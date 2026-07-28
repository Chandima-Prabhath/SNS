'use client'

import { create } from 'zustand'

export type ViewKey = 'chats' | 'status' | 'voice' | 'settings'

interface AppState {
  view: ViewKey
  setView: (v: ViewKey) => void

  activeChannelId: string | null
  setActiveChannel: (id: string | null) => void

  // Discord-style: which group is selected in the server rail.
  // 'dm' is a virtual group for direct messages. null = nothing selected.
  selectedGroupId: string | 'dm' | null
  setSelectedGroupId: (id: string | 'dm' | null) => void

  chatInfoOpen: boolean
  setChatInfoOpen: (open: boolean) => void

  replyTo: { id: string; body: string; senderName: string } | null
  setReplyTo: (r: { id: string; body: string; senderName: string } | null) => void

  chatFilter: 'all' | 'unread' | 'groups' | 'dms' | 'bots'
  setChatFilter: (f: AppState['chatFilter']) => void

  // Mobile sidebar
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // Mobile server rail drawer
  serverRailOpen: boolean
  setServerRailOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'chats',
  setView: (view) => set({ view }),

  activeChannelId: null,
  setActiveChannel: (id) => set({ activeChannelId: id, chatInfoOpen: false }),

  selectedGroupId: 'dm',
  setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),

  chatInfoOpen: false,
  setChatInfoOpen: (chatInfoOpen) => set({ chatInfoOpen }),

  replyTo: null,
  setReplyTo: (r) => set({ replyTo: r }),

  chatFilter: 'all',
  setChatFilter: (chatFilter) => set({ chatFilter }),

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  serverRailOpen: false,
  setServerRailOpen: (serverRailOpen) => set({ serverRailOpen }),
}))
