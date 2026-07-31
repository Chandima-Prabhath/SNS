'use client'

import { create } from 'zustand'

export interface Track {
  videoId: string
  title: string
  artist: string
  thumbnail: string | null
  durationSeconds: number | null
  album?: string | null
}

interface MusicState {
  currentTrack: Track | null
  isPlaying: boolean
  isLoading: boolean
  position: number
  volume: number

  // ─── Queue / playback options ──────────────────────────────────────────
  queue: Track[]
  /** Radio queue — autoplay tracks fetched ahead of time so they're ready
   *  when the main queue empties. The player populates this when a track
   *  starts playing, and predownloads the first one. This fixes background
   *  autoplay on mobile (no fetch needed when the song ends). */
  radioQueue: Track[]
  autoplay: boolean
  shuffle: boolean
  repeat: boolean

  // ─── Synced-room state ─────────────────────────────────────────────────
  activeRoomId: string | null

  // ─── Setters (state only — no socket side-effects) ────────────────────
  setCurrentTrack: (t: Track | null) => void
  setIsPlaying: (b: boolean) => void
  setIsLoading: (b: boolean) => void
  setPosition: (p: number) => void
  setVolume: (v: number) => void
  setQueue: (q: Track[]) => void
  addToQueue: (t: Track) => void
  removeFromQueue: (i: number) => void
  clearQueue: () => void
  setRadioQueue: (q: Track[]) => void
  popFromRadioQueue: () => Track | null
  setAutoplay: (b: boolean) => void
  setShuffle: (b: boolean) => void
  setRepeat: (b: boolean) => void
  setActiveRoomId: (id: string | null) => void
  stop: () => void

  /**
   * Atomically pops the next track from the queue, honoring the current
   * shuffle setting. Returns the popped track, or null if the queue is
   * empty. Used by the global player's `playNext` logic.
   */
  popNextFromQueue: () => Track | null
}

export const useMusicStore = create<MusicState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  isLoading: false,
  position: 0,
  volume: 0.8,
  queue: [],
  radioQueue: [],
  autoplay: true,
  shuffle: false,
  repeat: false,
  activeRoomId: null,

  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setPosition: (position) => set({ position }),
  setVolume: (volume) => set({ volume }),
  setQueue: (queue) => set({ queue }),
  addToQueue: (t) => set((s) => ({ queue: [...s.queue, t] })),
  removeFromQueue: (i) => set((s) => ({ queue: s.queue.filter((_, j) => j !== i) })),
  clearQueue: () => set({ queue: [] }),
  setRadioQueue: (radioQueue) => set({ radioQueue }),
  popFromRadioQueue: () => {
    const { radioQueue } = get()
    if (radioQueue.length === 0) return null
    const track = radioQueue[0]
    set({ radioQueue: radioQueue.slice(1) })
    return track
  },
  setAutoplay: (autoplay) => set({ autoplay }),
  setShuffle: (shuffle) => set({ shuffle }),
  setRepeat: (repeat) => set({ repeat }),
  setActiveRoomId: (activeRoomId) => set({ activeRoomId }),

  stop: () => set({ currentTrack: null, isPlaying: false, position: 0 }),

  popNextFromQueue: () => {
    const { queue, shuffle } = get()
    if (queue.length === 0) return null

    if (shuffle) {
      const idx = Math.floor(Math.random() * queue.length)
      const track = queue[idx]
      set({ queue: queue.filter((_, j) => j !== idx) })
      return track
    }

    const track = queue[0]
    set({ queue: queue.slice(1) })
    return track
  },
}))
