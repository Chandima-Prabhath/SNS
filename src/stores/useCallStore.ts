'use client'

import { create } from 'zustand'

interface CallState {
  callId: string | null
  channelId: string | null
  dmGroupId: string | null
  participants: Map<string, { userId: string; username: string; stream?: MediaStream; muted: boolean }>
  localStream: MediaStream | null
  localMuted: boolean
  status: 'idle' | 'connecting' | 'connected' | 'failed' | 'ended'

  start: (params: { callId: string; channelId?: string | null; dmGroupId?: string | null; localStream: MediaStream }) => void
  addPeer: (peerId: string, meta: { userId: string; username: string }) => void
  setPeerStream: (peerId: string, stream: MediaStream) => void
  setPeerMuted: (peerId: string, muted: boolean) => void
  setLocalMuted: (muted: boolean) => void
  setStatus: (s: CallState['status']) => void
  removePeer: (peerId: string) => void
  end: () => void
}

export const useCallStore = create<CallState>((set) => ({
  callId: null,
  channelId: null,
  dmGroupId: null,
  participants: new Map(),
  localStream: null,
  localMuted: false,
  status: 'idle',

  start: ({ callId, channelId = null, dmGroupId = null, localStream }) =>
    set({
      callId,
      channelId,
      dmGroupId,
      localStream,
      status: 'connecting',
      participants: new Map(),
      localMuted: false,
    }),

  addPeer: (peerId, meta) =>
    set((s) => {
      const participants = new Map(s.participants)
      participants.set(peerId, { ...meta, muted: false })
      return { participants }
    }),

  setPeerStream: (peerId, stream) =>
    set((s) => {
      const participants = new Map(s.participants)
      const p = participants.get(peerId)
      if (p) participants.set(peerId, { ...p, stream })
      return { participants }
    }),

  setPeerMuted: (peerId, muted) =>
    set((s) => {
      const participants = new Map(s.participants)
      const p = participants.get(peerId)
      if (p) participants.set(peerId, { ...p, muted })
      return { participants }
    }),

  setLocalMuted: (localMuted) => set({ localMuted }),

  setStatus: (status) => set({ status }),

  removePeer: (peerId) =>
    set((s) => {
      const participants = new Map(s.participants)
      participants.delete(peerId)
      return { participants }
    }),

  end: () =>
    set({
      callId: null,
      channelId: null,
      dmGroupId: null,
      participants: new Map(),
      localStream: null,
      localMuted: false,
      status: 'idle',
    }),
}))
