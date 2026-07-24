'use client'

import { create } from 'zustand'

export type ViewKey = 'chat' | 'status' | 'voice' | 'bots' | 'settings' | 'admin'

interface AppState {
  // Navigation
  view: ViewKey
  setView: (v: ViewKey) => void

  // Chat
  activeChannelId: string | null
  setActiveChannel: (id: string | null) => void

  // Reply target
  replyTo: { id: string; body: string; senderName: string } | null
  setReplyTo: (r: { id: string; body: string; senderName: string } | null) => void

  // Sidebar (mobile)
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'chat',
  setView: (view) => set({ view }),

  activeChannelId: null,
  setActiveChannel: (id) => set({ activeChannelId: id }),

  replyTo: null,
  setReplyTo: (r) => set({ replyTo: r }),

  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}))
