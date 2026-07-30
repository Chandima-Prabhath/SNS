'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Search, Play, Pause, SkipForward, Plus,
  Loader2, Radio, Headphones, X, ListMusic, Compass,
  Trash2, Repeat, Shuffle, Music as MusicIcon, Users,
  Flame, Sparkles, History, Library, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useMusicStore, type Track } from '@/stores/useMusicStore'
import { useMusicPlayer } from '@/components/music/global-music-player'
import { SpotlightCard, GlassSurface, GradientText, BorderGlow, ShinyText, StarBorder } from '@/components/reactbits'

interface Room {
  id: string
  name: string
  host: any
  currentVideoId: string | null
  currentState: string
  currentPosition: number
  queue: string
  members: any[]
}

type Tab = 'browse' | 'rooms' | 'queue' | 'library'

const HISTORY_KEY = 'adoo-music-history'
const MAX_HISTORY = 50

function loadHistory(): Track[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveHistory(tracks: Track[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(tracks.slice(0, MAX_HISTORY)))
  } catch {}
}

/**
 * MusicView — Browse / Rooms / Queue UI for the music feature.
 *
 * NOTE: This component does NOT own the audio element or the player bar.
 * Those live in <GlobalMusicPlayer /> (rendered at the app root) so that
 * playback persists across all tabs (Chats, Status, Calls, Settings, Music).
 *
 * This view reads playback state from `useMusicStore` and triggers actions
 * via `useMusicPlayer()`.
 */
export function MusicView() {
  const [tab, setTab] = useState<Tab>('browse')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qc = useQueryClient()
  const [history, setHistory] = useState<Track[]>([])

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  // Track when the current track changes — add to history
  useEffect(() => {
    if (currentTrack) {
      setHistory((prev) => {
        const filtered = prev.filter((t) => t.videoId !== currentTrack.videoId)
        const updated = [currentTrack, ...filtered].slice(0, MAX_HISTORY)
        saveHistory(updated)
        return updated
      })
    }
  }, [currentTrack])

  // ─── Playback state from the global store ─────────────────────────────
  const isPlaying = useMusicStore((s) => s.isPlaying)
  const queue = useMusicStore((s) => s.queue)
  const autoplay = useMusicStore((s) => s.autoplay)
  const shuffle = useMusicStore((s) => s.shuffle)
  const repeat = useMusicStore((s) => s.repeat)
  const activeRoomId = useMusicStore((s) => s.activeRoomId)
  const setActiveRoomId = useMusicStore((s) => s.setActiveRoomId)
  const setShuffle = useMusicStore((s) => s.setShuffle)
  const setRepeat = useMusicStore((s) => s.setRepeat)
  const setAutoplay = useMusicStore((s) => s.setAutoplay)

  // ─── Player actions (broadcast + audio handled by global player) ──────
  const { playTrack, playNext, removeFromQueue, clearQueue } = useMusicPlayer()

  // Fetch trending
  const { data: trendingData, isLoading: trendingLoading } = useQuery({
    queryKey: ['music-trending'],
    queryFn: async () => {
      const res = await fetch('/api/music/trending')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  // Fetch personalized home feed ("For You" recommendations).
  // The endpoint returns { sections: [{ title, tracks }] } — empty array on
  // failure (e.g. no YouTube cookies), so we can silently hide the area.
  const { data: homeData, isLoading: homeLoading } = useQuery({
    queryKey: ['music-home'],
    queryFn: async () => {
      const res = await fetch('/api/music/home')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  // Fetch rooms
  const { data: roomsData } = useQuery({
    queryKey: ['music-rooms'],
    queryFn: async () => {
      const res = await fetch('/api/music/rooms')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    refetchInterval: 10000,
  })

  // Create room
  const createRoom = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/music/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['music-rooms'] })
      setActiveRoomId(data.room.id)
      setTab('rooms')
      toast.success('Room created')
    },
  })

  // Delete room
  const deleteRoom = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await fetch(`/api/music/rooms/${roomId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music-rooms'] })
      if (activeRoomId) setActiveRoomId(null)
      toast.success('Room deleted')
    },
    onError: () => toast.error('Failed to delete room'),
  })

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!value.trim()) {
      setSearchResults([])
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(value)}`)
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json()
        setSearchResults(data.tracks || [])
      } catch (e: any) {
        toast.error(e.message || 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 500)
  }

  const trendingTracks = trendingData?.tracks || []
  const homeSections: { title: string; tracks: Track[] }[] = homeData?.sections || []
  const rooms = roomsData?.rooms || []

  return (
    <div className="h-full flex flex-col mesh-gradient overflow-hidden">
      {/* Header with gradient title and glassmorphic tabs */}
      <div className="shrink-0 px-4 pt-4 pb-2 border-b border-border/30">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2 mb-3">
            <MusicIcon className="w-7 h-7 text-primary" />
            <GradientText>Musical</GradientText>
          </h1>

          {/* Tab navigation — glassmorphic pill bar */}
          <GlassSurface className="max-w-xs" blur={12} opacity={0.05}>
            <div className="flex gap-1 p-1">
              {([
                ['browse', 'Browse', Compass],
                ['rooms', 'Rooms', Radio],
                ['queue', 'Queue', ListMusic],
                ['library', 'Library', Library],
              ] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-sm font-medium transition-all',
                    tab === key
                      ? 'gradient-primary text-primary-foreground shadow-glow'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  {key === 'queue' && queue.length > 0 && (
                    <span className="text-[10px] bg-primary-foreground/20 text-primary-foreground px-1.5 py-0.5 rounded-full">
                      {queue.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </GlassSurface>
        </div>
      </div>

      {/* Main content area — extra bottom padding so content isn't hidden
          behind the persistent global player bar. */}
      <div className="flex-1 overflow-y-auto pb-40 lg:pb-28">
        <div className="max-w-5xl mx-auto p-4 md:p-6">
          <AnimatePresence mode="wait">
            {tab === 'browse' && (
              <motion.div
                key="browse"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Search */}
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search songs, artists..."
                    className="pl-12 h-14 bg-black/20 backdrop-blur-xl border-white/10 rounded-2xl text-lg focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-all shadow-inner"
                  />
                  {searching && (
                    <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* Search results */}
                {searchResults.length > 0 ? (
                  <div className="space-y-1.5">
                    <h2 className="text-sm font-bold uppercase tracking-wider mb-3">
                      <ShinyText shimmerDuration={4} className="text-sm">
                        Results
                      </ShinyText>
                    </h2>
                    {searchResults.map((track) => (
                      <TrackRow
                        key={track.videoId}
                        track={track}
                        onPlay={() => playTrack(track)}
                        onAddToQueue={() => playTrack(track, true)}
                        isCurrent={currentTrack?.videoId === track.videoId}
                        isPlaying={
                          isPlaying && currentTrack?.videoId === track.videoId
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* For You — personalized recommendation sections.
                        Each section is rendered as a horizontal scrolling row
                        so the user can swipe through tracks without leaving
                        the browse tab. Hidden entirely when the home feed is
                        unavailable (empty sections array). */}
                    {homeLoading && (
                      <div className="space-y-3">
                        <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                        <div className="flex gap-3 overflow-hidden">
                          {[1, 2, 3, 4].map((i) => (
                            <div
                              key={i}
                              className="shrink-0 w-40 md:w-44 space-y-2 animate-pulse"
                            >
                              <div className="aspect-square rounded-xl bg-muted" />
                              <div className="h-3 bg-muted rounded w-3/4" />
                              <div className="h-2 bg-muted rounded w-1/2" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!homeLoading &&
                      homeSections.map((section) => (
                        <div key={section.title} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <h2 className="text-sm font-bold uppercase tracking-wider">
                              <ShinyText shimmerDuration={5} className="text-sm">
                                {section.title}
                              </ShinyText>
                            </h2>
                          </div>
                          <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x no-scrollbar">
                            {section.tracks.map((track: Track) => (
                              <div
                                key={track.videoId}
                                className="snap-start shrink-0 w-40 md:w-44"
                              >
                                <TrackCard
                                  track={track}
                                  onPlay={() => playTrack(track)}
                                  onAddToQueue={() => playTrack(track, true)}
                                  isCurrent={
                                    currentTrack?.videoId === track.videoId
                                  }
                                  isPlaying={
                                    isPlaying &&
                                    currentTrack?.videoId === track.videoId
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                    {/* Trending */}
                    <div className="pt-2">
                      <div className="flex items-center gap-2 mb-4">
                        <Flame className="w-4 h-4 text-primary" />
                        <h2 className="text-sm font-bold uppercase tracking-wider">
                          <ShinyText shimmerDuration={5} className="text-sm">
                            Trending Now
                          </ShinyText>
                        </h2>
                      </div>
                      {trendingLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                          {[1, 2, 3, 4, 5, 6].map((i) => (
                            <div key={i} className="space-y-2 animate-pulse">
                              <div className="aspect-square rounded-xl bg-muted" />
                              <div className="h-3 bg-muted rounded w-3/4" />
                              <div className="h-2 bg-muted rounded w-1/2" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                          {trendingTracks.map((track: Track) => (
                            <TrackCard
                              key={track.videoId}
                              track={track}
                              onPlay={() => playTrack(track)}
                              onAddToQueue={() => playTrack(track, true)}
                              isCurrent={currentTrack?.videoId === track.videoId}
                              isPlaying={
                                isPlaying &&
                                currentTrack?.videoId === track.videoId
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {tab === 'rooms' && (
              <motion.div
                key="rooms"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Listening Rooms
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const name = prompt('Room name?')
                      if (name?.trim()) createRoom.mutate(name)
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Create Room
                  </Button>
                </div>

                {rooms.length === 0 ? (
                  <Card className="p-12 text-center border-dashed">
                    <Headphones
                      className="w-12 h-12 mx-auto text-muted-foreground mb-3"
                      strokeWidth={1.5}
                    />
                    <p className="font-medium">No rooms yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Create a room to listen together with friends.
                    </p>
                  </Card>
                ) : (
                  <div className="grid gap-2">
                    {rooms.map((room: Room) => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        isActive={activeRoomId === room.id}
                        onJoin={() => {
                          // Just set the active room — the global player's
                          // socket effect joins the channel and requests
                          // the host's current state automatically.
                          setActiveRoomId(room.id)
                          // Also call the API to auto-join as a member
                          fetch(`/api/music/rooms/${room.id}`).catch(() => {})
                        }}
                        onDelete={() => deleteRoom.mutate(room.id)}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {tab === 'queue' && (
              <motion.div
                key="queue"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-primary" />
                    <h2 className="text-sm font-bold uppercase tracking-wider">
                      <ShinyText shimmerDuration={4} className="text-sm">
                        Play Queue
                      </ShinyText>
                    </h2>
                  </div>
                  {queue.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearQueue}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>

                {/* Currently playing */}
                {currentTrack && (
                  <StarBorder color="oklch(0.68 0.24 264)" className="w-full">
                    <SpotlightCard spotlightColor="rgba(var(--primary), 0.15)" className="p-5 rounded-2xl border-0 bg-gradient-to-br from-primary/8 to-transparent">
                      <div className="text-[10px] uppercase tracking-widest text-primary font-bold mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_oklch(0.68_0.24_264/0.6)]" />
                        <ShinyText shimmerDuration={3} className="text-[10px]">Now Playing</ShinyText>
                      </div>
                    <div className="flex items-center gap-4">
                      {currentTrack.thumbnail ? (
                        <div className="relative w-16 h-16 rounded-xl overflow-hidden shadow-lg ring-1 ring-white/10">
                          <img
                            src={currentTrack.thumbnail}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-xl gradient-primary flex items-center justify-center shadow-lg">
                          <Radio className="w-6 h-6 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-semibold truncate text-foreground">
                          {currentTrack.title}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {currentTrack.artist}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setShuffle(!shuffle)}
                          className={cn(
                            'p-2.5 rounded-xl transition-all',
                            shuffle
                              ? 'text-primary bg-primary/10 shadow-glow'
                              : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
                          )}
                          aria-label="Toggle shuffle"
                        >
                          <Shuffle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setRepeat(!repeat)}
                          className={cn(
                            'p-2.5 rounded-xl transition-all',
                            repeat
                              ? 'text-primary bg-primary/10 shadow-glow'
                              : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
                          )}
                          aria-label="Toggle repeat"
                        >
                          <Repeat className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setAutoplay(!autoplay)}
                          className={cn(
                            'p-2.5 rounded-xl transition-all',
                            autoplay
                              ? 'text-primary bg-primary/10 shadow-glow'
                              : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
                          )}
                          title="Autoplay recommendations"
                          aria-label="Toggle autoplay"
                        >
                          <Radio className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    </SpotlightCard>
                  </StarBorder>
                )}

                {/* Queue list */}
                {queue.length === 0 ? (
                  <Card className="p-8 text-center border-dashed">
                    <ListMusic
                      className="w-10 h-10 mx-auto text-muted-foreground mb-2"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm text-muted-foreground">
                      Queue is empty. Add songs from Browse or search.
                    </p>
                  </Card>
                ) : (
                    <div className="space-y-1.5">
                      {queue.map((track, i) => (
                        <div
                          key={`${track.videoId}-${i}`}
                          className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.06] transition-all group border border-transparent hover:border-white/5">
                          <span className="text-xs text-muted-foreground w-6 text-center font-medium">
                            {i + 1}
                          </span>
                        {track.thumbnail ? (
                          <img
                            src={track.thumbnail}
                            alt=""
                            className="w-10 h-10 rounded object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <ListMusic className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {track.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {track.artist}
                          </div>
                        </div>
                        <button
                          onClick={() => playTrack(track)}
                          className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition-opacity"
                          title="Play this track now"
                          aria-label="Play this track now"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                          <button
                            onClick={() => removeFromQueue(i)}
                            className="p-1.5 rounded-lg text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove from queue"
                            aria-label="Remove from queue"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                )}

                {/* Quick action: skip to next */}
                {currentTrack && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => playNext()}
                    className="w-full"
                  >
                    <SkipForward className="w-4 h-4 mr-2" />
                    Skip to next
                  </Button>
                )}
              </motion.div>
            )}

            {tab === 'library' && (
              <motion.div
                key="library"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Recently Played */}
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Recently Played
                  </h2>
                  {history.length === 0 ? (
                    <Card className="p-8 text-center border-dashed">
                      <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
                      <p className="text-sm text-muted-foreground">No play history yet</p>
                    </Card>
                  ) : (
                    <div className="space-y-1">
                      {history.map((track, i) => (
                        <TrackRow
                          key={`${track.videoId}-${i}`}
                          track={track}
                          onPlay={() => playTrack(track)}
                          onAddToQueue={() => playTrack(track, true)}
                          isCurrent={currentTrack?.videoId === track.videoId}
                          isPlaying={isPlaying && currentTrack?.videoId === track.videoId}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Clear history button */}
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHistory([])
                      saveHistory([])
                      toast.success('History cleared')
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Clear History
                  </Button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ─── Track Row (list view) ─────────────────────────────────────────────────
function TrackRow({
  track,
  onPlay,
  onAddToQueue,
  isCurrent,
  isPlaying,
}: {
  track: Track
  onPlay: () => void
  onAddToQueue: () => void
  isCurrent: boolean
  isPlaying: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 p-3 rounded-2xl transition-all group hover:bg-white/[0.04]',
        isCurrent && 'bg-primary/5 hover:bg-primary/10',
      )}
    >
      <button
        onClick={onPlay}
        className="flex items-center gap-4 flex-1 min-w-0 text-left"
      >
        {track.thumbnail ? (
          <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-sm ring-1 ring-white/5">
            <img
              src={track.thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
              {isCurrent && isPlaying ? (
                <Pause className="w-5 h-5 text-white drop-shadow-md" />
              ) : (
                <Play className="w-5 h-5 text-white ml-1 drop-shadow-md" />
              )}
            </div>
          </div>
        ) : (
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
            <ListMusic className="w-6 h-6 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[15px] font-semibold truncate transition-colors',
              isCurrent ? 'text-primary' : 'text-foreground',
            )}
          >
            {track.title}
          </div>
          <div className="text-sm text-muted-foreground truncate">
            {track.artist}
          </div>
        </div>
      </button>
      <button
        onClick={onAddToQueue}
        className="p-2.5 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all shrink-0"
        title="Add to queue"
        aria-label="Add to queue"
      >
        <Plus className="w-5 h-5" />
      </button>
    </div>
  )
}

// ─── Track Card (grid view) ────────────────────────────────────────────────
function TrackCard({
  track,
  onPlay,
  onAddToQueue,
  isCurrent,
  isPlaying,
}: {
  track: Track
  onPlay: () => void
  onAddToQueue: () => void
  isCurrent: boolean
  isPlaying: boolean
}) {
  return (
    <SpotlightCard
      className={cn(
        'group transition-all rounded-2xl overflow-hidden',
        isCurrent ? 'ring-2 ring-primary shadow-glow' : 'hover:scale-[1.02] border border-white/5',
      )}
    >
      <button onClick={onPlay} className="w-full">
        {track.thumbnail ? (
          <div className="aspect-square relative">
            <img
              src={track.thumbnail}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full gradient-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 shadow-glow">
                {isCurrent && isPlaying ? (
                  <Pause className="w-6 h-6 text-primary-foreground" />
                ) : (
                  <Play className="w-6 h-6 text-primary-foreground ml-1" />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="aspect-square bg-muted flex items-center justify-center">
            <ListMusic className="w-10 h-10 text-muted-foreground" />
          </div>
        )}
      </button>
      <div className="p-3 flex items-start gap-2 bg-card/50 backdrop-blur-md absolute bottom-0 inset-x-0">
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[13px] font-semibold truncate',
              isCurrent ? 'text-primary' : 'text-foreground',
            )}
          >
            {track.title}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {track.artist}
          </div>
        </div>
        <button
          onClick={onAddToQueue}
          className="p-1.5 rounded-full bg-white/10 text-white opacity-0 group-hover:opacity-100 hover:bg-primary hover:text-primary-foreground transition-all shrink-0"
          title="Add to queue"
          aria-label="Add to queue"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </SpotlightCard>
  )
}

// ─── Room Card ─────────────────────────────────────────────────────────────
// Note: we no longer show the raw member count — it includes stale members
// who joined and left (we don't track leftAt for music rooms). Instead we
// show a "Listening" indicator that's only lit when the host is actively
// playing, which is a more accurate signal of "is anything happening here
// right now".
function RoomCard({
  room,
  isActive,
  onJoin,
  onDelete,
}: {
  room: Room
  isActive: boolean
  onJoin: () => void
  onDelete?: () => void
}) {
  const isPlaying = room.currentState === 'playing'
  return (
    <div className="relative group">
      {isActive && (
        <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary/50 to-purple-500/50 opacity-50 blur-md transition-opacity group-hover:opacity-75" />
      )}
      <GlassSurface
        blur={12}
        opacity={isActive ? 0.08 : 0.02}
        className={cn(
          'w-full flex items-center gap-4 p-4 transition-all',
          isActive
            ? 'border-primary/50'
            : 'border-white/5 hover:bg-white/[0.03]',
        )}
      >
        <button
          onClick={onJoin}
          className="flex items-center gap-4 flex-1 min-w-0 text-left"
        >
          <div
            className={cn(
              'w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all shadow-sm',
              isPlaying
                ? 'bg-primary/20 text-primary pulse-glow ring-1 ring-primary/30'
                : 'bg-black/30 text-muted-foreground ring-1 ring-white/10',
            )}
          >
            <Radio className={cn('w-6 h-6', isPlaying && 'animate-pulse')} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base truncate text-foreground">{room.name}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>Hosted by {room.host?.displayName || 'Unknown'}</span>
              {isPlaying ? (
                <>
                  <span className="text-white/30">•</span>
                  <span className="text-status-online flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-status-online shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
                    Listening now
                  </span>
                </>
              ) : (
                <>
                  <span className="text-white/30">•</span>
                  <span className="text-muted-foreground">Idle</span>
                </>
              )}
            </div>
          </div>
          <div className={cn(
            "shrink-0 text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm",
            isActive ? "bg-primary text-primary-foreground shadow-glow" : "bg-white/5 text-foreground hover:bg-white/10 border border-white/10"
          )}>
            {isActive ? 'In Room' : 'Join'}
          </div>
        </button>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`Delete room "${room.name}"?`)) onDelete()
            }}
            className="shrink-0 p-2.5 rounded-full text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-300 transition-all"
            title="Delete room"
            aria-label="Delete room"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </GlassSurface>
    </div>
  )
}
