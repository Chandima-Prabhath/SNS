'use client'

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useState,
  useMemo,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import {
  Play, Pause, SkipForward, X, Volume2, Music as MusicIcon,
  Shuffle, Repeat, ChevronUp, ChevronDown, Loader2, ListMusic, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSocket } from '@/hooks/useSocket'
import { useMusicStore, type Track } from '@/stores/useMusicStore'
import { useAppStore } from '@/stores/useAppStore'

/**
 * GlobalMusicPlayer
 * ─────────────────────────────────────────────────────────────────────────
 * Renders the persistent <audio> element and the bottom player bar at the
 * app root level so that audio playback is NOT destroyed when the user
 * switches tabs (Chats, Status, Calls, Settings, Music).
 *
 * Architecture:
 *   - The Zustand store (`useMusicStore`) is the single source of truth for
 *     playback state (currentTrack, isPlaying, position, volume, queue,
 *     autoplay, shuffle, repeat, activeRoomId).
 *   - This component owns the <audio> element and all audio + Socket.io
 *     side-effects. It reads from the store and writes back to it.
 *   - The MusicView (browse / rooms / queue UI) reads state from the store
 *     and calls the action functions exposed here via `useMusicPlayer()`.
 *   - Socket.io sync events are listened to here. When a remote sync is
 *     applied, the store is updated; the audio element is then loaded /
 *     seeked directly. A ref flag (`applyingRemoteRef`) prevents
 *     `timeupdate` events from fighting with the applied position.
 */

interface MusicPlayerContextValue {
  /** Play a track (or add it to the queue if addToQueue=true). */
  playTrack: (track: Track, addToQueue?: boolean) => Promise<void>
  /** Advance to the next track (queue → autoplay → repeat → stop). */
  playNext: () => Promise<void>
  /** Toggle play / pause. */
  togglePlay: () => void
  /** Seek to a position (seconds). */
  handleSeek: (pos: number) => void
  /** Stop playback entirely (clears current track). */
  stop: () => void
  /** Add a track to the queue (broadcasts to room). */
  addToQueue: (track: Track) => void
  /** Remove a track from the queue by index (broadcasts to room). */
  removeFromQueue: (index: number) => void
  /** Clear the entire queue (broadcasts to room). */
  clearQueue: () => void
}

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null)

const NOOP_PLAYER: MusicPlayerContextValue = {
  playTrack: async () => {},
  playNext: async () => {},
  togglePlay: () => {},
  handleSeek: () => {},
  stop: () => {},
  addToQueue: () => {},
  removeFromQueue: () => {},
  clearQueue: () => {},
}

/**
 * Access the global music player's action functions.
 *
 * Safe to call from any component rendered inside <GlobalMusicPlayer>.
 * Returns no-op functions if no provider is present (defensive).
 */
export function useMusicPlayer(): MusicPlayerContextValue {
  const ctx = useContext(MusicPlayerContext)
  return ctx ?? NOOP_PLAYER
}

export function GlobalMusicPlayer({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const { socket } = useSocket()

  // ─── Store state (subscribe to slices) ────────────────────────────────
  const currentTrack = useMusicStore((s) => s.currentTrack)
  const isPlaying = useMusicStore((s) => s.isPlaying)
  const isLoading = useMusicStore((s) => s.isLoading)
  const position = useMusicStore((s) => s.position)
  const volume = useMusicStore((s) => s.volume)
  const queue = useMusicStore((s) => s.queue)
  const radioQueue = useMusicStore((s) => s.radioQueue)
  const shuffle = useMusicStore((s) => s.shuffle)
  const repeat = useMusicStore((s) => s.repeat)
  const activeRoomId = useMusicStore((s) => s.activeRoomId)

  // ─── Store actions ────────────────────────────────────────────────────
  const setCurrentTrack = useMusicStore((s) => s.setCurrentTrack)
  const setIsPlaying = useMusicStore((s) => s.setIsPlaying)
  const setPosition = useMusicStore((s) => s.setPosition)
  const setVolume = useMusicStore((s) => s.setVolume)
  const setQueue = useMusicStore((s) => s.setQueue)
  const storeAddToQueue = useMusicStore((s) => s.addToQueue)
  const storeRemoveFromQueue = useMusicStore((s) => s.removeFromQueue)
  const storeClearQueue = useMusicStore((s) => s.clearQueue)

  // ─── Refs for cross-render coordination ───────────────────────────────
  // The videoId currently loaded into the <audio> element. Used to detect
  // when currentTrack.videoId changes so we know to (re)load the stream.
  const loadedVideoIdRef = useRef<string | null>(null)
  // When applying a remote sync that changes the track, this holds the
  // position we should seek to once the new stream has loaded.
  const pendingSeekRef = useRef<number | null>(null)
  // True while we're applying state that arrived from a remote sync event.
  // Prevents local `timeupdate` from overwriting the freshly-applied
  // position and prevents echoing sync events back to the room.
  const applyingRemoteRef = useRef(false)

  // ─── Helper: broadcast a sync event to the active room ────────────────
  const broadcastSync = useCallback(
    (payload: {
      state: string
      position: number
      videoId?: string
      trackInfo?: Partial<Track>
      queue?: Track[]
    }) => {
      if (!activeRoomId || !socket) return
      socket.emit('music:sync', {
        roomId: activeRoomId,
        ...payload,
      })
    },
    [activeRoomId, socket],
  )

  // ─── Action: play a track ─────────────────────────────────────────────
  const playTrack = useCallback(
    async (track: Track, addToQueue = false) => {
      const state = useMusicStore.getState()

      if (addToQueue && state.currentTrack) {
        state.addToQueue(track)
        toast.success(`Added to queue: ${track.title}`)
        // Broadcast the updated queue so members see it
        broadcastSync({
          state: state.isPlaying ? 'playing' : 'paused',
          position: audioRef.current?.currentTime || 0,
          queue: useMusicStore.getState().queue,
        })
        return
      }

      // Set state first so the UI updates instantly
      setCurrentTrack(track)
      setIsPlaying(true)
      setPosition(0)
      useMusicStore.getState().setIsLoading(true)

      // Broadcast to room (include the full queue so members sync)
      broadcastSync({
        state: 'playing',
        position: 0,
        videoId: track.videoId,
        trackInfo: {
          title: track.title,
          artist: track.artist,
          thumbnail: track.thumbnail,
          durationSeconds: track.durationSeconds,
        },
        queue: useMusicStore.getState().queue,
      })

      // Load + play the audio
      if (audioRef.current) {
        audioRef.current.src = `/api/music/stream/${track.videoId}`
        audioRef.current.volume = useMusicStore.getState().volume
        loadedVideoIdRef.current = track.videoId
        pendingSeekRef.current = null
        try {
          await audioRef.current.play()
          useMusicStore.getState().setIsLoading(false)
        } catch (e: any) {
          useMusicStore.getState().setIsLoading(false)
          if (e?.name === 'NotSupportedError' || e?.name === 'MediaError') {
            try {
              const res = await fetch(`/api/music/stream/${track.videoId}`, {
                method: 'HEAD',
              })
              if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Could not download this track.')
                setCurrentTrack(null)
                setIsPlaying(false)
              }
            } catch {
              toast.error(
                'The server is downloading this track — try again in a moment.',
              )
            }
          }
        }
      }
    },
    [broadcastSync, setCurrentTrack, setIsPlaying, setPosition],
  )

  // ─── Action: play next track ──────────────────────────────────────────
  const playNext = useCallback(async () => {
    const state = useMusicStore.getState()
    let nextTrack: Track | null = state.popNextFromQueue()

    // If main queue is empty, try the radio queue (prefetched autoplay tracks)
    if (!nextTrack && state.autoplay && state.currentTrack) {
      nextTrack = state.popFromRadioQueue()

      // If radio queue is also empty, fetch related tracks (fallback)
      if (!nextTrack) {
        try {
          console.log('[player] radio queue empty, fetching related tracks...')
          const res = await fetch(
            `/api/music/related/${state.currentTrack.videoId}`,
          )
          if (res.ok) {
            const data = await res.json()
            if (data.tracks?.length > 0) {
              // Store all but the first in the radio queue
              state.setRadioQueue(data.tracks.slice(1, 6))
              nextTrack = data.tracks[0] as Track
            }
          }
        } catch {
          console.error('[player] autoplay fetch failed')
        }
      }
    }

    if (nextTrack) {
      await playTrack(nextTrack)
    } else if (state.repeat && state.currentTrack) {
      await playTrack(state.currentTrack)
    } else {
      setIsPlaying(false)
      setPosition(0)
    }
  }, [playTrack, setIsPlaying, setPosition])

  // ─── Action: toggle play / pause ──────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    const state = useMusicStore.getState()
    if (!audio || !state.currentTrack) return

    if (state.isPlaying) {
      audio.pause()
      setIsPlaying(false)
      broadcastSync({
        state: 'paused',
        position: audio.currentTime,
        queue: state.queue,
      })
    } else {
      audio.play().catch(() => {})
      setIsPlaying(true)
      broadcastSync({
        state: 'playing',
        position: audio.currentTime,
        queue: state.queue,
      })
    }
  }, [broadcastSync, setIsPlaying])

  // ─── Action: seek ─────────────────────────────────────────────────────
  const handleSeek = useCallback(
    (pos: number) => {
      const audio = audioRef.current
      const state = useMusicStore.getState()
      if (!audio) return
      audio.currentTime = pos
      setPosition(pos)
      broadcastSync({
        state: state.isPlaying ? 'playing' : 'paused',
        position: pos,
        queue: state.queue,
      })
    },
    [broadcastSync, setPosition],
  )

  // ─── Action: stop playback entirely ───────────────────────────────────
  const stop = useCallback(() => {
    setCurrentTrack(null)
    setIsPlaying(false)
    setPosition(0)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    loadedVideoIdRef.current = null
  }, [setCurrentTrack, setIsPlaying, setPosition])

  // ─── Action: add to queue (broadcasts) ────────────────────────────────
  const addToQueue = useCallback(
    (track: Track) => {
      const state = useMusicStore.getState()
      storeAddToQueue(track)
      broadcastSync({
        state: state.isPlaying ? 'playing' : 'paused',
        position: audioRef.current?.currentTime || 0,
        queue: useMusicStore.getState().queue,
      })
    },
    [broadcastSync, storeAddToQueue],
  )

  // ─── Action: remove from queue (broadcasts) ───────────────────────────
  const removeFromQueue = useCallback(
    (index: number) => {
      const state = useMusicStore.getState()
      storeRemoveFromQueue(index)
      broadcastSync({
        state: state.isPlaying ? 'playing' : 'paused',
        position: audioRef.current?.currentTime || 0,
        queue: useMusicStore.getState().queue,
      })
    },
    [broadcastSync, storeRemoveFromQueue],
  )

  // ─── Action: clear queue (broadcasts) ─────────────────────────────────
  const clearQueue = useCallback(() => {
    const state = useMusicStore.getState()
    storeClearQueue()
    broadcastSync({
      state: state.isPlaying ? 'playing' : 'paused',
      position: audioRef.current?.currentTime || 0,
      queue: [],
    })
  }, [broadcastSync, storeClearQueue])

  // ─── Effect: keep <audio> volume in sync with the store ───────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  // ─── Effect: wire up <audio> event listeners ──────────────────────────
  // Re-attaches whenever playNext changes (which it does when its deps
  // change). The listeners read fresh state via `useMusicStore.getState()`
  // so they never see stale data.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      // Don't fight with a freshly-applied remote position
      if (applyingRemoteRef.current) return
      setPosition(audio.currentTime)
    }
    const onEnded = () => {
      void playNext()
    }
    const onError = () => {
      const state = useMusicStore.getState()
      state.setIsLoading(false)
      if (state.currentTrack) {
        toast.error('Could not play this track — skipping...')
        void playNext()
      }
    }
    const onWaiting = () => {
      useMusicStore.getState().setIsLoading(true)
    }
    const onPlaying = () => {
      useMusicStore.getState().setIsLoading(false)
    }
    const onCanPlay = () => {
      useMusicStore.getState().setIsLoading(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('canplay', onCanPlay)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('canplay', onCanPlay)
    }
  }, [playNext, setPosition])

  // ─── Effect: Pre-download upcoming queue tracks ───────────────────────
  // When a track starts playing, pre-download the next 2 tracks in the queue
  // so they're ready to play instantly when the user gets to them.
  //
  // The predownload API is fire-and-forget (returns 202 immediately and
  // downloads in the background). We don't await the response — just fire
  // the request and let the server handle it.
  useEffect(() => {
    if (!currentTrack || queue.length === 0) return
    // Pre-download the next 2 tracks (or all if queue has fewer)
    const toPreDownload = queue.slice(0, 2)
    for (const track of toPreDownload) {
      console.log(`[predownload] requesting ${track.videoId} (${track.title})`)
      // Fire-and-forget — the server returns 202 immediately and downloads
      // in the background. We use keepalive so the request survives page
      // navigation, and catch() to prevent unhandled rejection errors.
      fetch(`/api/music/predownload/${track.videoId}`, { method: 'POST', keepalive: true })
        .then((res) => {
          console.log(`[predownload] ${track.videoId} → HTTP ${res.status} (${res.ok ? 'cached/downloading' : 'error'})`)
        })
        .catch((e) => console.error(`[predownload] ${track.videoId} network error:`, e))
    }
  }, [currentTrack, queue])

  // ─── Effect: Prefetch radio queue + predownload for autoplay ──────────
  // When a track starts playing and the main queue is empty, fetch related
  // tracks ahead of time and store them in the radio queue. Also predownload
  // the first radio queue track so it's ready to play instantly when the
  // current song ends — even if the app is in the background on mobile.
  useEffect(() => {
    if (!currentTrack) return
    const state = useMusicStore.getState()
    if (!state.autoplay) return
    if (queue.length > 0) return // don't prefetch if main queue has items
    if (state.radioQueue.length > 0) {
      // Radio queue already has items — just predownload the first one
      const nextRadio = state.radioQueue[0]
      console.log(`[radio] predownloading next: ${nextRadio.videoId} (${nextRadio.title})`)
      fetch(`/api/music/predownload/${nextRadio.videoId}`, { method: 'POST', keepalive: true })
        .then((res) => console.log(`[radio] predownload ${nextRadio.videoId} → ${res.status}`))
        .catch(() => {})
      return
    }
    // Radio queue is empty — fetch related tracks
    console.log(`[radio] fetching related for ${currentTrack.videoId}...`)
    fetch(`/api/music/related/${currentTrack.videoId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.tracks?.length > 0) {
          const tracks = data.tracks.slice(0, 5)
          state.setRadioQueue(tracks)
          console.log(`[radio] got ${tracks.length} tracks, predownloading first: ${tracks[0].title}`)
          // Predownload the first track
          fetch(`/api/music/predownload/${tracks[0].videoId}`, { method: 'POST', keepalive: true })
            .then((res) => console.log(`[radio] predownload ${tracks[0].videoId} → ${res.status}`))
            .catch(() => {})
        }
      })
      .catch((e) => console.error('[radio] fetch failed:', e))
  }, [currentTrack, queue.length])

  // ─── Effect: Socket.io room sync ──────────────────────────────────────
  // Joins the music room's socket channel, requests the host's current
  // state, and listens for incoming sync events. Re-subscribes whenever
  // the active room changes.
  useEffect(() => {
    if (!socket || !activeRoomId) return

    socket.emit('music:join', activeRoomId)

    // Ask the host for the current state shortly after joining. The small
    // delay gives the join room propagation time to complete.
    const requestTimer = setTimeout(() => {
      socket.emit('music:request-sync', activeRoomId)
    }, 500)

    // ── Incoming sync from the host (or another member's broadcast) ──
    const onSync = (data: {
      roomId: string
      state: string
      position: number
      videoId?: string
      trackInfo?: Track
      queue?: Track[]
      serverTimestamp: number
    }) => {
      if (data.roomId !== activeRoomId) return

      applyingRemoteRef.current = true

      const networkDelay = (Date.now() - data.serverTimestamp) / 1000
      const adjustedPosition =
        data.position + (data.state === 'playing' ? networkDelay : 0)

      const state = useMusicStore.getState()
      const audio = audioRef.current

      // Track changed → load the new stream and seek to host's position
      if (
        data.videoId &&
        (!state.currentTrack || state.currentTrack.videoId !== data.videoId)
      ) {
        const track: Track = data.trackInfo || {
          videoId: data.videoId,
          title: 'Now Playing',
          artist: '',
          thumbnail: null,
          durationSeconds: null,
        }
        pendingSeekRef.current = adjustedPosition
        setCurrentTrack(track)
        setIsPlaying(data.state === 'playing')
        setPosition(adjustedPosition)

        if (audio) {
          audio.src = `/api/music/stream/${data.videoId}`
          audio.volume = state.volume
          loadedVideoIdRef.current = data.videoId
          // Wait a tick for the new src to be accepted before seeking
          setTimeout(() => {
            if (audioRef.current) {
              try {
                audioRef.current.currentTime = adjustedPosition
              } catch {
                // Stream not seekable yet — ignore
              }
              if (data.state === 'playing') {
                audioRef.current.play().catch(() => {})
              }
            }
            applyingRemoteRef.current = false
          }, 200)
        } else {
          applyingRemoteRef.current = false
        }
      } else if (audio && state.currentTrack) {
        // Same track — sync position + play/pause state only
        const drift = Math.abs(audio.currentTime - adjustedPosition)
        if (drift > 1.5) {
          try {
            audio.currentTime = adjustedPosition
          } catch {
            // ignore
          }
          setPosition(adjustedPosition)
        }
        if (data.state === 'playing' && !state.isPlaying) {
          audio.play().catch(() => {})
          setIsPlaying(true)
        } else if (data.state === 'paused' && state.isPlaying) {
          audio.pause()
          setIsPlaying(false)
        }
        applyingRemoteRef.current = false
      } else {
        applyingRemoteRef.current = false
      }

      // Apply queue update from remote (broadcast by host)
      if (Array.isArray(data.queue)) {
        setQueue(data.queue)
      }
    }

    // ── A member just joined and is requesting our current state ──
    // Only the host (or anyone with a current track) responds.
    const onRequestSync = (data: {
      roomId: string
      fromUserId: string
    }) => {
      if (data.roomId !== activeRoomId) return
      const state = useMusicStore.getState()
      if (!state.currentTrack || !socket) return

      socket.emit('music:sync', {
        roomId: activeRoomId,
        state: state.isPlaying ? 'playing' : 'paused',
        position: audioRef.current?.currentTime || 0,
        videoId: state.currentTrack.videoId,
        trackInfo: {
          title: state.currentTrack.title,
          artist: state.currentTrack.artist,
          thumbnail: state.currentTrack.thumbnail,
          durationSeconds: state.currentTrack.durationSeconds,
        },
        queue: state.queue,
      })
    }

    socket.on('music:sync', onSync)
    socket.on('music:request-sync', onRequestSync)

    return () => {
      clearTimeout(requestTimer)
      socket.off('music:sync', onSync)
      socket.off('music:request-sync', onRequestSync)
      socket.emit('music:leave', activeRoomId)
      applyingRemoteRef.current = false
    }
  }, [
    socket,
    activeRoomId,
    setCurrentTrack,
    setIsPlaying,
    setPosition,
    setQueue,
  ])

  // ─── Bot music control listener ───────────────────────────────────────
  // Listens for 'music:bot-command' socket events emitted by the server when
  // a bot's music_play / music_pause / music_skip / music_queue_add / music_stop
  // node fires. The server forwards the command to the target user's sockets.
  useEffect(() => {
    if (!socket) return

    const onBotCommand = async (cmd: {
      action: 'play' | 'pause' | 'skip' | 'queue' | 'stop'
      query?: string
    }) => {
      console.log('[music:bot-command] received:', cmd)
      const state = useMusicStore.getState()

      try {
        switch (cmd.action) {
          case 'play': {
            if (!cmd.query) return
            // Search for the track via the music search API
            const res = await fetch(`/api/music/search?q=${encodeURIComponent(cmd.query)}`)
            if (!res.ok) return
            const data = await res.json()
            const track = data.tracks?.[0]
            if (track) {
              await playTrack(track)
              toast.success(`🎵 Playing: ${track.title}`)
            } else {
              toast.error(`No results for "${cmd.query}"`)
            }
            break
          }
          case 'pause': {
            state.setIsPlaying(false)
            toast.info('⏸️ Music paused')
            break
          }
          case 'skip': {
            const next = state.popNextFromQueue()
            if (next) {
              await playTrack(next)
              toast.success('⏭️ Skipped to next song')
            } else {
              state.stop()
              toast.info('⏭️ Queue is empty')
            }
            break
          }
          case 'queue': {
            if (!cmd.query) return
            const res = await fetch(`/api/music/search?q=${encodeURIComponent(cmd.query)}`)
            if (!res.ok) return
            const data = await res.json()
            const track = data.tracks?.[0]
            if (track) {
              state.addToQueue(track)
              toast.success(`📋 Added to queue: ${track.title}`)
            }
            break
          }
          case 'stop': {
            state.stop()
            toast.info('⏹️ Music stopped')
            break
          }
        }
      } catch (e) {
        console.error('[music:bot-command] failed:', e)
      }
    }

    socket.on('music:bot-command', onBotCommand)
    return () => {
      socket.off('music:bot-command', onBotCommand)
    }
  }, [socket, playTrack])

  // ─── Memoized context value ───────────────────────────────────────────
  const contextValue = useMemo<MusicPlayerContextValue>(
    () => ({
      playTrack,
      playNext,
      togglePlay,
      handleSeek,
      stop,
      addToQueue,
      removeFromQueue,
      clearQueue,
    }),
    [
      playTrack,
      playNext,
      togglePlay,
      handleSeek,
      stop,
      addToQueue,
      removeFromQueue,
      clearQueue,
    ],
  )

  return (
    <MusicPlayerContext.Provider value={contextValue}>
      {children}
      {/* The hidden audio element — persists across all tabs */}
      <audio ref={audioRef} />
      {/* The persistent floating player — collapses to a mini FAB */}
      <AnimatePresence>
        {currentTrack && (
          <PlayerBar
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            isLoading={isLoading}
            position={position}
            volume={volume}
            queue={queue}
            radioQueue={radioQueue}
            shuffle={shuffle}
            repeat={repeat}
            onTogglePlay={togglePlay}
            onSeek={handleSeek}
            onNext={playNext}
            onStop={stop}
            onVolumeChange={setVolume}
            onShuffleToggle={() =>
              useMusicStore.getState().setShuffle(!shuffle)
            }
            onRepeatToggle={() =>
              useMusicStore.getState().setRepeat(!repeat)
            }
            onPlayTrack={playTrack}
          />
        )}
      </AnimatePresence>
    </MusicPlayerContext.Provider>
  )
}

// ─── Player Bar — Collapsible Floating Mini-Player ───────────────────────
// When collapsed: a small floating circle (FAB) with album art + play/pause.
// When expanded: a full player bar with all controls.
// The player collapses automatically when the user switches away from the
// Music tab, so it doesn't block content on other pages.

function PlayerBar({
  currentTrack,
  isPlaying,
  isLoading,
  position,
  volume,
  queue,
  radioQueue,
  shuffle,
  repeat,
  onTogglePlay,
  onSeek,
  onNext,
  onStop,
  onVolumeChange,
  onShuffleToggle,
  onRepeatToggle,
  onPlayTrack,
}: {
  currentTrack: Track
  isPlaying: boolean
  isLoading: boolean
  position: number
  volume: number
  queue: Track[]
  radioQueue: Track[]
  shuffle: boolean
  repeat: boolean
  onTogglePlay: () => void
  onSeek: (pos: number) => void
  onNext: () => Promise<void>
  onStop: () => void
  onVolumeChange: (v: number) => void
  onShuffleToggle: () => void
  onRepeatToggle: () => void
  onPlayTrack: (track: Track, queue?: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { view } = useAppStore()
  const isDraggingRef = useRef(false)
  const constraintsRef = useRef<HTMLDivElement>(null)

  // Auto-collapse when not on the Music tab
  useEffect(() => {
    if (view !== 'music') setExpanded(false)
  }, [view])

  // Prevent clicks from firing after a drag ends
  const handlePlayPauseClick = useCallback(() => {
    if (isDraggingRef.current) return
    onTogglePlay()
  }, [onTogglePlay])

  // Expand only when the FAB wasn't being dragged
  const handleExpandClick = useCallback(() => {
    if (isDraggingRef.current) return
    setExpanded(true)
  }, [])

  return (
    <>
      {/* Invisible drag constraint area — keeps FAB on screen */}
      <div ref={constraintsRef} className="fixed inset-0 z-0 pointer-events-none" />

      {/* ─── Collapsed: Draggable Floating Mini-Player (FAB) ─── */}
      <AnimatePresence>
        {!expanded && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            drag
            dragConstraints={constraintsRef}
            dragElastic={0.1}
            dragTransition={{ power: 0.15, timeConstant: 150 }}
            whileDrag={{ scale: 1.08, cursor: 'grabbing' }}
            onDragStart={() => { isDraggingRef.current = true }}
            onDragEnd={() => { setTimeout(() => { isDraggingRef.current = false }, 100) }}
            className="fixed bottom-20 lg:bottom-6 right-4 z-[60] cursor-grab touch-none"
          >
            <div className={cn(
              "flex items-center gap-2.5 rounded-full p-1.5 pr-3 shadow-xl pointer-events-auto adoo-playing-border",
              !isPlaying && "adoo-paused"
            )}>
              {/* Album art / Play-pause */}
              <button
                onClick={handlePlayPauseClick}
                onPointerDown={(e) => e.stopPropagation()}
                className="relative w-12 h-12 rounded-full gradient-primary shadow-glow hover:scale-105 active:scale-95 transition-transform flex items-center justify-center shrink-0"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {currentTrack.thumbnail ? (
                  <img
                    src={currentTrack.thumbnail}
                    alt=""
                    className="absolute inset-0 w-full h-full rounded-full object-cover opacity-80"
                  />
                ) : (
                  <MusicIcon className="w-5 h-5 text-primary-foreground relative z-10" />
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 text-white animate-spin relative z-10" />
                  ) : isPlaying ? (
                    <div className="flex items-end gap-0.5 h-4 relative z-10">
                      <span className="adoo-eq-bar" style={{ height: 8 }} />
                      <span className="adoo-eq-bar" style={{ height: 12 }} />
                      <span className="adoo-eq-bar" style={{ height: 6 }} />
                      <span className="adoo-eq-bar" style={{ height: 10 }} />
                    </div>
                  ) : (
                    <Play className="w-5 h-5 text-white ml-0.5 relative z-10" />
                  )}
                </div>
              </button>

              {/* Track title — visible on desktop, tap target for expand on mobile */}
              <button
                onClick={handleExpandClick}
                onPointerDown={(e) => e.stopPropagation()}
                className="hidden sm:block min-w-0 max-w-[140px] text-left"
              >
                <div className="text-xs font-medium truncate text-foreground">{currentTrack.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{currentTrack.artist}</div>
              </button>

              {/* Expand button */}
              <button
                onClick={handleExpandClick}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-foreground hover:bg-white/20 hover:scale-105 active:scale-95 transition-all shrink-0"
                aria-label="Expand player"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Expanded: Compact Player Bar (step 2) ─── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-16 lg:bottom-4 left-3 right-3 lg:left-1/2 lg:-translate-x-1/2 lg:right-auto lg:w-[660px] z-[60] pointer-events-auto"
          >
            <div
              className={cn(
                "rounded-2xl shadow-2xl adoo-playing-border",
                !isPlaying && "adoo-paused"
              )}
            >
            {/* Mobile layout */}
            <div className="lg:hidden px-4 py-3 space-y-2.5">
              <div className="flex items-center gap-3">
                {currentTrack.thumbnail ? (
                  <img src={currentTrack.thumbnail} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 ring-1 ring-white/10 shadow-md" />
                ) : (
                  <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-md">
                    <MusicIcon className="w-5 h-5 text-primary-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{currentTrack.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button onClick={onTogglePlay} size="icon" className="rounded-full h-10 w-10 gradient-primary shadow-glow">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </Button>
                  <Button onClick={onNext} variant="ghost" size="icon" className="h-9 w-9 text-foreground">
                    <SkipForward className="w-4 h-4" />
                  </Button>
                  {/* Expand to full Music page (step 3) */}
                  <Button onClick={() => { setExpanded(false); useAppStore.getState().setView('music'); window.location.hash = 'music-queue' }} variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground">
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <Button onClick={() => setExpanded(false)} variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground">
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">{formatTime(position)}</span>
                <input
                  type="range"
                  min={0}
                  max={currentTrack.durationSeconds || 300}
                  value={position}
                  onChange={(e) => onSeek(parseFloat(e.target.value))}
                  className="flex-1 player-slider"
                />
                <span className="text-[10px] text-muted-foreground tabular-nums w-8">{formatTime(currentTrack.durationSeconds || 0)}</span>
              </div>
              {/* Volume + shuffle/repeat on mobile */}
              <div className="flex items-center gap-2">
                <button onClick={onShuffleToggle} className={cn('p-1.5 rounded-lg transition-all', shuffle ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:text-foreground')}>
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
                <button onClick={onRepeatToggle} className={cn('p-1.5 rounded-lg transition-all', repeat ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:text-foreground')}>
                  <Repeat className="w-3.5 h-3.5" />
                </button>
                <Volume2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-auto" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="w-20 volume-slider"
                />
              </div>
            </div>

            {/* Desktop layout — Spotify-style 3-column */}
            <div className="hidden lg:grid lg:grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3">
              {/* Left: Track info */}
              <div className="flex items-center gap-3 min-w-0 justify-self-start">
                {currentTrack.thumbnail ? (
                  <img src={currentTrack.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg gradient-primary flex items-center justify-center shrink-0">
                    <MusicIcon className="w-5 h-5 text-primary-foreground" />
                  </div>
                )}
                <div className="min-w-0 max-w-[180px]">
                  <div className="text-sm font-semibold truncate">{currentTrack.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
                </div>
              </div>

              {/* Center: Controls + seek bar */}
              <div className="flex flex-col items-center gap-1.5 justify-self-center w-[320px]">
                <div className="flex items-center gap-4">
                  <button onClick={onShuffleToggle} className={cn('transition-colors', shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground')} aria-label="Shuffle">
                    <Shuffle className="w-4 h-4" />
                  </button>
                  <button onClick={onNext} className="text-foreground hover:scale-110 transition-transform" aria-label="Next">
                    <SkipForward className="w-5 h-5" />
                  </button>
                  <button onClick={onTogglePlay} className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform" aria-label={isPlaying ? 'Pause' : 'Play'}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <button onClick={onStop} className="text-foreground hover:scale-110 transition-transform" aria-label="Stop">
                    <X className="w-5 h-5" />
                  </button>
                  <button onClick={onRepeatToggle} className={cn('transition-colors', repeat ? 'text-primary' : 'text-muted-foreground hover:text-foreground')} aria-label="Repeat">
                    <Repeat className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 w-full">
                  <span className="text-[10px] text-muted-foreground tabular-nums w-9 text-right">{formatTime(position)}</span>
                  <input
                    type="range"
                    min={0}
                    max={currentTrack.durationSeconds || 300}
                    value={position}
                    onChange={(e) => onSeek(parseFloat(e.target.value))}
                    className="flex-1 player-slider"
                  />
                  <span className="text-[10px] text-muted-foreground tabular-nums w-9">{formatTime(currentTrack.durationSeconds || 0)}</span>
                </div>
              </div>

              {/* Right: Volume (vertical popout) + expand/collapse */}
              <div className="flex items-center gap-1 justify-self-end pr-1 relative z-50">
                <div className="volume-popout">
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-1" aria-label="Volume">
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <div className="volume-track">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                    />
                  </div>
                </div>
                <button onClick={() => { setExpanded(false); useAppStore.getState().setView('music'); window.location.hash = 'music-queue' }} className="text-muted-foreground hover:text-foreground transition-colors p-1" aria-label="Open full music page">
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button onClick={() => setExpanded(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1" aria-label="Collapse player">
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
