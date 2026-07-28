'use client'

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import {
  Play, Pause, SkipForward, X, Volume2, Music as MusicIcon,
  Shuffle, Repeat,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSocket } from '@/hooks/useSocket'
import { useMusicStore, type Track } from '@/stores/useMusicStore'

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
  const position = useMusicStore((s) => s.position)
  const volume = useMusicStore((s) => s.volume)
  const queue = useMusicStore((s) => s.queue)
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
        } catch (e: any) {
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

    if (!nextTrack && state.autoplay && state.currentTrack) {
      try {
        const res = await fetch(
          `/api/music/related/${state.currentTrack.videoId}`,
        )
        if (res.ok) {
          const data = await res.json()
          if (data.tracks?.length > 0) {
            nextTrack = data.tracks[0] as Track
          }
        }
      } catch {
        // Autoplay failed — just stop
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
      if (state.currentTrack) {
        toast.error('Could not play this track — skipping...')
        void playNext()
      }
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [playNext, setPosition])

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
      {/* The persistent bottom player bar */}
      <AnimatePresence>
        {currentTrack && (
          <PlayerBar
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            position={position}
            volume={volume}
            queue={queue}
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
          />
        )}
      </AnimatePresence>
    </MusicPlayerContext.Provider>
  )
}

// ─── Player Bar (renders inside GlobalMusicPlayer) ──────────────────────
function PlayerBar({
  currentTrack,
  isPlaying,
  position,
  volume,
  queue,
  shuffle,
  repeat,
  onTogglePlay,
  onSeek,
  onNext,
  onStop,
  onVolumeChange,
  onShuffleToggle,
  onRepeatToggle,
}: {
  currentTrack: Track
  isPlaying: boolean
  position: number
  volume: number
  queue: Track[]
  shuffle: boolean
  repeat: boolean
  onTogglePlay: () => void
  onSeek: (pos: number) => void
  onNext: () => void
  onStop: () => void
  onVolumeChange: (v: number) => void
  onShuffleToggle: () => void
  onRepeatToggle: () => void
}) {
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      // Persistent across all tabs. Positioned above the mobile bottom nav
      // (bottom-16 = 64px, matching the nav's actual height) and pinned to
      // the bottom on desktop (where there's no bottom nav).
      className="fixed bottom-16 lg:bottom-0 left-0 right-0 z-30 bg-popover/95 backdrop-blur-2xl border-t border-border/50 shadow-2xl"
    >
      {/* Mobile layout: compact — track info + play/pause only */}
      <div className="lg:hidden px-3 py-2.5 flex items-center gap-3">
        {currentTrack.thumbnail ? (
          <img
            src={currentTrack.thumbnail}
            alt=""
            className="w-10 h-10 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center shrink-0">
            <MusicIcon className="w-4 h-4 text-primary-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">
            {currentTrack.title}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {currentTrack.artist}
          </div>
          {/* Seek bar below track info on mobile */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[8px] text-muted-foreground tabular-nums">
              {formatTime(position)}
            </span>
            <input
              type="range"
              min={0}
              max={currentTrack.durationSeconds || 300}
              value={position}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="flex-1 h-0.5 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
            />
            <span className="text-[8px] text-muted-foreground tabular-nums">
              {formatTime(currentTrack.durationSeconds || 0)}
            </span>
          </div>
        </div>
        <Button
          onClick={onTogglePlay}
          size="icon"
          className="rounded-full h-9 w-9 shrink-0 gradient-primary"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </Button>
        <Button
          onClick={onNext}
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-foreground"
          aria-label="Next track"
        >
          <SkipForward className="w-4 h-4" />
        </Button>
      </div>

      {/* Desktop layout: full — track info + seek bar + controls + volume */}
      <div className="hidden lg:flex max-w-5xl mx-auto px-4 py-2.5 items-center gap-4">
        {/* Track info */}
        <div className="flex items-center gap-3 min-w-0 w-64 shrink-0">
          {currentTrack.thumbnail ? (
            <img
              src={currentTrack.thumbnail}
              alt=""
              className="w-12 h-12 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg gradient-primary flex items-center justify-center shrink-0">
              <MusicIcon className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {currentTrack.title}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {currentTrack.artist}
            </div>
          </div>
        </div>

        {/* Seek bar + controls (center, flexible) */}
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-3">
            <Button
              onClick={onShuffleToggle}
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 hover:bg-accent',
                shuffle ? 'text-primary' : 'text-foreground',
              )}
              aria-label="Shuffle"
            >
              <Shuffle className="w-3.5 h-3.5" />
            </Button>
            <Button
              onClick={onNext}
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-foreground hover:bg-accent"
              aria-label="Next track"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button
              onClick={onTogglePlay}
              size="icon"
              className="rounded-full h-10 w-10 gradient-primary shadow-glow hover:scale-105 transition-transform"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 ml-0.5" />
              )}
            </Button>
            <Button
              onClick={onStop}
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-foreground hover:bg-accent"
              aria-label="Stop"
            >
              <X className="w-4 h-4" />
            </Button>
            <Button
              onClick={onRepeatToggle}
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 hover:bg-accent',
                repeat ? 'text-primary' : 'text-foreground',
              )}
              aria-label="Repeat"
            >
              <Repeat className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full max-w-md">
            <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">
              {formatTime(position)}
            </span>
            <input
              type="range"
              min={0}
              max={currentTrack.durationSeconds || 300}
              value={position}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="flex-1 h-1 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
            />
            <span className="text-[10px] text-muted-foreground tabular-nums w-8">
              {formatTime(currentTrack.durationSeconds || 0)}
            </span>
          </div>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 shrink-0 w-28">
          <Volume2 className="w-4 h-4 text-muted-foreground" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="flex-1 h-1 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
            aria-label="Volume"
          />
        </div>
      </div>
    </motion.div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
