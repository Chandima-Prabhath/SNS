'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Search, Play, Pause, SkipForward, Plus,
  Loader2, Radio, Headphones, X, ListMusic, Compass,
  Trash2, Repeat, Shuffle, Music as MusicIcon, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useMusicStore, type Track } from '@/stores/useMusicStore'
import { useMusicPlayer } from '@/components/music/global-music-player'
import { SpotlightCard, GlassSurface, GradientText, BorderGlow } from '@/components/reactbits'

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

type Tab = 'browse' | 'rooms' | 'queue'

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

  // ─── Playback state from the global store ─────────────────────────────
  const currentTrack = useMusicStore((s) => s.currentTrack)
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
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search songs, artists..."
                    className="pl-9 h-11 bg-card/50 backdrop-blur-sm border-border/30"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>

                {/* Search results */}
                {searchResults.length > 0 ? (
                  <div className="space-y-1.5">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Results
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
                    {/* Trending */}
                    <div>
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                        Trending Now
                      </h2>
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
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Play Queue
                  </h2>
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
                  <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                    <div className="text-[10px] uppercase tracking-wider text-primary font-bold mb-2">
                      Now Playing
                    </div>
                    <div className="flex items-center gap-3">
                      {currentTrack.thumbnail ? (
                        <img
                          src={currentTrack.thumbnail}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg gradient-primary flex items-center justify-center">
                          <Radio className="w-5 h-5 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {currentTrack.title}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {currentTrack.artist}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setShuffle(!shuffle)}
                          className={cn(
                            'p-2 rounded-lg transition-colors',
                            shuffle
                              ? 'text-primary bg-primary/10'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          aria-label="Toggle shuffle"
                        >
                          <Shuffle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setRepeat(!repeat)}
                          className={cn(
                            'p-2 rounded-lg transition-colors',
                            repeat
                              ? 'text-primary bg-primary/10'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          aria-label="Toggle repeat"
                        >
                          <Repeat className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setAutoplay(!autoplay)}
                          className={cn(
                            'p-2 rounded-lg transition-colors',
                            autoplay
                              ? 'text-primary bg-primary/10'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          title="Autoplay recommendations"
                          aria-label="Toggle autoplay"
                        >
                          <Radio className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
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
                  <div className="space-y-1">
                    {queue.map((track, i) => (
                      <div
                        key={`${track.videoId}-${i}`}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors group"
                      >
                        <span className="text-xs text-muted-foreground w-5 text-center">
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
        'flex items-center gap-3 p-2.5 rounded-xl transition-colors group',
        isCurrent ? 'bg-primary/10' : 'hover:bg-accent/50',
      )}
    >
      <button
        onClick={onPlay}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        {track.thumbnail ? (
          <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0">
            <img
              src={track.thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {isCurrent && isPlaying ? (
                <Pause className="w-4 h-4 text-white" />
              ) : (
                <Play className="w-4 h-4 text-white ml-0.5" />
              )}
            </div>
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <ListMusic className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-sm font-medium truncate',
              isCurrent && 'text-primary',
            )}
          >
            {track.title}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {track.artist}
          </div>
        </div>
      </button>
      <button
        onClick={onAddToQueue}
        className="p-2 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition-all"
        title="Add to queue"
        aria-label="Add to queue"
      >
        <Plus className="w-4 h-4" />
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
        'group transition-all',
        isCurrent ? 'ring-2 ring-primary' : 'hover:scale-[1.02]',
      )}
    >
      <button onClick={onPlay} className="w-full">
        {track.thumbnail ? (
          <div className="aspect-square relative">
            <img
              src={track.thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
              <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-glow">
                {isCurrent && isPlaying ? (
                  <Pause className="w-5 h-5 text-primary-foreground" />
                ) : (
                  <Play className="w-5 h-5 text-primary-foreground ml-0.5" />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="aspect-square bg-muted flex items-center justify-center">
            <ListMusic className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </button>
      <div className="p-2 flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-xs font-medium truncate',
              isCurrent && 'text-primary',
            )}
          >
            {track.title}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {track.artist}
          </div>
        </div>
        <button
          onClick={onAddToQueue}
          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition-all shrink-0"
          title="Add to queue"
          aria-label="Add to queue"
        >
          <Plus className="w-3 h-3" />
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
    <div
      className={cn(
        'w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all border group',
        isActive
          ? 'bg-primary/10 border-primary/30 shadow-glow'
          : 'bg-card/50 border-border/30 hover:bg-accent/50 hover:border-primary/20',
      )}
    >
      <button
        onClick={onJoin}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <div
          className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all',
            isPlaying
              ? 'bg-primary/20 text-primary pulse-glow'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <Radio className={cn('w-5 h-5', isPlaying && 'animate-pulse')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{room.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>Hosted by {room.host?.displayName || 'Unknown'}</span>
            {isPlaying ? (
              <>
                <span>·</span>
                <span className="text-status-online flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-online animate-pulse" />
                  Listening now
                </span>
              </>
            ) : (
              <>
                <span>·</span>
                <span className="text-muted-foreground">Idle</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-xs font-medium text-primary px-3 py-1.5 rounded-lg bg-primary/10">
          {isActive ? 'In Room' : 'Join'}
        </div>
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete room "${room.name}"?`)) onDelete()
          }}
          className="shrink-0 p-2 rounded-lg text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
          title="Delete room"
          aria-label="Delete room"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
