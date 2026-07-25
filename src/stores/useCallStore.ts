'use client'

import { create } from 'zustand'
import type { CallStatus, CallParticipant } from '@/lib/call-manager'

interface CallState {
  status: CallStatus
  callId: string | null
  localStream: MediaStream | null
  participants: CallParticipant[]
  localMuted: boolean
  videoEnabled: boolean
  isVideoCall: boolean

  setStatus: (status: CallStatus) => void
  setCallId: (callId: string | null) => void
  setLocalStream: (stream: MediaStream | null) => void
  setParticipants: (participants: CallParticipant[]) => void
  setLocalMuted: (muted: boolean) => void
  setVideoEnabled: (enabled: boolean) => void
  setVideoCall: (isVideo: boolean) => void
  reset: () => void
}

export const useCallStore = create<CallState>((set) => ({
  status: 'idle',
  callId: null,
  localStream: null,
  participants: [],
  localMuted: false,
  videoEnabled: true,
  isVideoCall: false,

  setStatus: (status) => set({ status }),
  setCallId: (callId) => set({ callId }),
  setLocalStream: (localStream) => set({ localStream }),
  setParticipants: (participants) => set({ participants }),
  setLocalMuted: (localMuted) => set({ localMuted }),
  setVideoEnabled: (videoEnabled) => set({ videoEnabled }),
  setVideoCall: (isVideoCall) => set({ isVideoCall }),
  reset: () =>
    set({
      status: 'idle',
      callId: null,
      localStream: null,
      participants: [],
      localMuted: false,
      videoEnabled: true,
      isVideoCall: false,
    }),
}))
