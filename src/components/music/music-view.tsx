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
  Flame, Sparkles, History, Library, Clock, Heart, ListPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useMusicStore, type Track } from '@/stores/useMusicStore'
import { useMusicPlayer } from '@/components/music/global-music-player'
import { InviteDialog } from '@/components/ui/invite-dialog'
import { useConfirm } from '@/hooks/useConfirm'
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
type LibraryTab = 'history' | 'liked' | 'playlists'

const HISTORY_KEY = 'adoo-music-history'
const MAX_HISTORY = 50

/** Track shape used by the UI. The DB stores the same fields (minus the
 *  `order` column on PlaylistSong which we don't expose in the UI). */
interface DbTrack extends Track {}
interface Playlist {
  id: string
  name: string
  songs: Track[]
  updatedAt?: string
}

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
  const searchAbortRef = useRef<AbortController | null>(null)
  const qc = useQueryClient()
  const [history, setHistory] = useState<Track[]>([])
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('history')
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [showNewPlaylistInput, setShowNewPlaylistInput] = useState(false)
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [inviteTarget, setInviteTarget] = useState<{ type: 'call' | 'music'; roomId?: string; roomName?: string } | null>(null)

  // ── DB-backed liked songs (react-query) ──────────────────────────────
  const { data: likedData } = useQuery({
    queryKey: ['music-liked'],
    queryFn: async () => {
      const res = await fetch('/api/music/liked')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })
  const liked: Track[] = likedData?.songs || []

  // ── DB-backed playlists (react-query) ────────────────────────────────
  const { data: playlistsData } = useQuery({
    queryKey: ['music-playlists'],
    queryFn: async () => {
      const res = await fetch('/api/music/playlists')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })
  const playlists: Playlist[] = (playlistsData?.playlists || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    songs: (p.songs || []).map((s: any) => ({
      videoId: s.videoId,
      title: s.title,
      artist: s.artist,
      thumbnail: s.thumbnail,
      durationSeconds: s.durationSeconds,
    })),
    updatedAt: p.updatedAt,
  }))

  // ─── Playback state from the global store ─────────────────────────────
  const currentTrack = useMusicStore((s) => s.currentTrack)
  const isPlaying = useMusicStore((s) => s.isPlaying)
  const queue = useMusicStore((s) => s.queue)
  const autoplay = useMusicStore((s) => s.autoplay)
  const shuffle = useMusicStore((s) => s.shuffle)
  const repeat = useMusicStore((s) => s.repeat)

  // ── Up Next: read from the music store's radio queue (prefetched by the player) ─
  const radioQueue = useMusicStore((s) => s.radioQueue)
  const upNextTracks: Track[] = radioQueue.slice(0, 5)
  const activeRoomId = useMusicStore((s) => s.activeRoomId)
  const setActiveRoomId = useMusicStore((s) => s.setActiveRoomId)
  const setShuffle = useMusicStore((s) => s.setShuffle)
  const setRepeat = useMusicStore((s) => s.setRepeat)
  const setAutoplay = useMusicStore((s) => s.setAutoplay)

  // ─── Player actions (broadcast + audio handled by global player) ──────
  const { playTrack, playNext, removeFromQueue, clearQueue } = useMusicPlayer()

  // Load history on mount (history stays in localStorage — it's per-device)
  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  // ── Liked songs helpers (DB-backed) ──────────────────────────────────
  const toggleLike = async (track: Track) => {
    const isLikedVal = liked.some((t) => t.videoId === track.videoId)
    // Optimistic update — update the cache immediately
    qc.setQueryData(['music-liked'], (old: any) => {
      if (!old) return { songs: [track] }
      const songs = isLikedVal
        ? old.songs.filter((t: Track) => t.videoId !== track.videoId)
        : [track, ...old.songs]
      return { ...old, songs }
    })
    try {
      if (isLikedVal) {
        await fetch(`/api/music/liked?videoId=${track.videoId}`, { method: 'DELETE' })
      } else {
        await fetch('/api/music/liked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(track),
        })
      }
    } catch {
      // Revert on error
      qc.invalidateQueries({ queryKey: ['music-liked'] })
      toast.error('Failed to update liked songs')
    }
  }

  const isLiked = (videoId: string) => liked.some((t) => t.videoId === videoId)

  // ── Playlist helpers (DB-backed, with optimistic updates) ────────────
  const createPlaylist = async (name: string) => {
    if (!name.trim()) return
    try {
      const res = await fetch('/api/music/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      // Add the new playlist to the cache immediately (optimistic)
      qc.setQueryData(['music-playlists'], (old: any) => {
        const newPlaylist = { ...data.playlist, songs: [] }
        return { playlists: [newPlaylist, ...(old?.playlists || [])] }
      })
      toast.success(`Playlist "${name}" created`)
      setNewPlaylistName('')
      setShowNewPlaylistInput(false)
    } catch {
      toast.error('Failed to create playlist')
    }
  }

  const addToPlaylist = async (playlistId: string, track: Track) => {
    // Optimistic update — add the song to the playlist in the cache
    qc.setQueryData(['music-playlists'], (old: any) => {
      if (!old) return old
      return {
        ...old,
        playlists: old.playlists.map((pl: any) =>
          pl.id === playlistId
            ? {
                ...pl,
                songs: pl.songs.some((s: Track) => s.videoId === track.videoId)
                  ? pl.songs // already in playlist — don't add duplicate
                  : [...pl.songs, track],
              }
            : pl
        ),
      }
    })
    try {
      const res = await fetch(`/api/music/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(track),
      })
      if (!res.ok) throw new Error('failed')
      const pl = playlists.find((p) => p.id === playlistId)
      toast.success(`Added to "${pl?.name}"`)
    } catch {
      // Revert on error
      qc.invalidateQueries({ queryKey: ['music-playlists'] })
      toast.error('Failed to add to playlist')
    }
  }

  const deletePlaylist = async (playlistId: string) => {
    // Optimistic update — remove from cache immediately
    qc.setQueryData(['music-playlists'], (old: any) => {
      if (!old) return old
      return {
        ...old,
        playlists: old.playlists.filter((pl: any) => pl.id !== playlistId),
      }
    })
    try {
      const res = await fetch(`/api/music/playlists/${playlistId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      toast.success('Playlist deleted')
    } catch {
      // Revert on error
      qc.invalidateQueries({ queryKey: ['music-playlists'] })
      toast.error('Failed to delete playlist')
    }
  }

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

  // Create room — optimistic update (room appears instantly)
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
      // Add the new room to the cache immediately (optimistic)
      qc.setQueryData(['music-rooms'], (old: any) => {
        const newRoom = { ...data.room }
        return { rooms: [newRoom, ...(old?.rooms || [])] }
      })
      setActiveRoomId(data.room.id)
      setTab('rooms')
      toast.success('Room created')
    },
    onError: () => toast.error('Failed to create room'),
  })

  // Delete room — optimistic update
  const deleteRoom = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await fetch(`/api/music/rooms/${roomId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onMutate: async (roomId) => {
      // Optimistic update — remove from cache immediately
      qc.setQueryData(['music-rooms'], (old: any) => {
        if (!old) return old
        return { ...old, rooms: old.rooms.filter((r: any) => r.id !== roomId) }
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music-rooms'] })
      if (activeRoomId) setActiveRoomId(null)
      toast.success('Room deleted')
    },
    onError: () => toast.error('Failed to delete room'),
  })

  // Debounced search with AbortController to cancel stale requests
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    // Abort any in-flight search request
    if (searchAbortRef.current) {
      searchAbortRef.current.abort()
      searchAbortRef.current = null
    }
    if (!value.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true)
      const controller = new AbortController()
      searchAbortRef.current = controller
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Search failed')
        const data = await res.json()
        // Only update if this request wasn't superseded
        if (searchAbortRef.current === controller) {
          setSearchResults(data.tracks || [])
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return // expected — superseded by newer search
        toast.error(e.message || 'Search failed')
      } finally {
        if (searchAbortRef.current === controller) {
          setSearching(false)
          searchAbortRef.current = null
        }
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
          <GlassSurface className="max-w-md" blur={12} opacity={0.05}>
            <div className="flex gap-1 p-1 overflow-x-auto no-scrollbar">
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
                    'flex-1 min-w-fit flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap',
                    tab === key
                      ? 'gradient-primary text-primary-foreground shadow-glow'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
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
                        isLiked={isLiked(track.videoId)}
                        onToggleLike={() => toggleLike(track)}
                        onAddToPlaylist={() => setAddToPlaylistTrack(track)}
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
                    onClick={() => { setShowCreateRoom(true); setNewRoomName('') }}
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
                        onInvite={() => setInviteTarget({ type: 'music', roomId: room.id, roomName: room.name })}
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
                  <SpotlightCard spotlightColor="rgba(var(--primary), 0.15)" className="p-4 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 to-transparent">
                    <div className="text-[10px] uppercase tracking-widest text-primary font-bold mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_oklch(0.68_0.24_264/0.6)]" />
                      <ShinyText shimmerDuration={3} className="text-[10px]">Now Playing</ShinyText>
                    </div>
                    <div className="flex items-center gap-3">
                      {currentTrack.thumbnail ? (
                        <div className="relative w-12 h-12 md:w-16 md:h-16 rounded-xl overflow-hidden shadow-lg ring-1 ring-white/10 shrink-0">
                          <img
                            src={currentTrack.thumbnail}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl gradient-primary flex items-center justify-center shadow-lg shrink-0">
                          <Radio className="w-5 h-5 md:w-6 md:h-6 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm md:text-base font-semibold truncate text-foreground">
                          {currentTrack.title}
                        </div>
                        <div className="text-xs md:text-sm text-muted-foreground truncate">
                          {currentTrack.artist}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3 justify-center">
                      <button
                        onClick={() => setShuffle(!shuffle)}
                        className={cn(
                          'p-2 rounded-lg transition-all',
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
                          'p-2 rounded-lg transition-all',
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
                          'p-2 rounded-lg transition-all',
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
                  </SpotlightCard>
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

                {/* Up Next (Autoplay) — shows what will play when the queue is empty */}
                {queue.length === 0 && currentTrack && autoplay && upNextTracks.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Up Next (Autoplay)
                    </h3>
                    <div className="space-y-1 opacity-80">
                      {upNextTracks.map((track, i) => (
                        <div
                          key={`${track.videoId}-${i}`}
                          className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06] transition-all group cursor-pointer"
                          onClick={() => playTrack(track)}
                        >
                          <span className="text-xs text-muted-foreground w-6 text-center font-medium">
                            {i + 1}
                          </span>
                          {track.thumbnail ? (
                            <img
                              src={track.thumbnail}
                              alt=""
                              className="w-9 h-9 rounded object-cover"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded bg-muted flex items-center justify-center">
                              <ListMusic className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{track.title}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{track.artist}</div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); playTrack(track) }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                            title="Play now"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); playTrack(track, true) }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                            title="Add to queue"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
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
                {/* Library sub-tabs */}
                <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit">
                  <button
                    onClick={() => setLibraryTab('history')}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                      libraryTab === 'history' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <History className="w-4 h-4" />
                    History
                  </button>
                  <button
                    onClick={() => setLibraryTab('liked')}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                      libraryTab === 'liked' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Heart className="w-4 h-4" />
                    Liked
                    {liked.length > 0 && (
                      <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 rounded-full">{liked.length}</span>
                    )}
                  </button>
                  <button
                    onClick={() => setLibraryTab('playlists')}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                      libraryTab === 'playlists' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <ListMusic className="w-4 h-4" />
                    Playlists
                    {playlists.length > 0 && (
                      <span className="text-[10px] bg-primary/20 text-primary px-1.5 rounded-full">{playlists.length}</span>
                    )}
                  </button>
                </div>

                {/* ── HISTORY TAB ────────────────────────────────────────── */}
                {libraryTab === 'history' && (
                  <div>
                    {history.length === 0 ? (
                      <Card className="p-8 text-center border-dashed">
                        <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
                        <p className="text-sm text-muted-foreground">No play history yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Songs you play will appear here</p>
                      </Card>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <History className="w-3.5 h-3.5" />
                            Recently Played · {history.length}
                          </h2>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setHistory([])
                              saveHistory([])
                              toast.success('History cleared')
                            }}
                            className="text-red-400 hover:text-red-300 h-7 text-xs"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Clear
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {history.map((track, i) => (
                            <TrackRow
                              key={`${track.videoId}-${i}`}
                              track={track}
                              onPlay={() => playTrack(track)}
                              onAddToQueue={() => playTrack(track, true)}
                              isCurrent={currentTrack?.videoId === track.videoId}
                              isPlaying={isPlaying && currentTrack?.videoId === track.videoId}
                              isLiked={isLiked(track.videoId)}
                              onToggleLike={() => toggleLike(track)}
                              onAddToPlaylist={() => setAddToPlaylistTrack(track)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── LIKED TAB ─────────────────────────────────────────── */}
                {libraryTab === 'liked' && (
                  <div>
                    {liked.length === 0 ? (
                      <Card className="p-8 text-center border-dashed">
                        <Heart className="w-10 h-10 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
                        <p className="text-sm text-muted-foreground">No liked songs yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Tap the heart on any song to save it here</p>
                      </Card>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Heart className="w-3.5 h-3.5" />
                            Liked Songs · {liked.length}
                          </h2>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              // Play all liked songs starting from the first
                              playTrack(liked[0])
                              for (let i = 1; i < liked.length; i++) {
                                playTrack(liked[i], true)
                              }
                            }}
                            className="h-7 text-xs"
                          >
                            <Play className="w-3 h-3 mr-1" />
                            Play All
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {liked.map((track, i) => (
                            <TrackRow
                              key={`${track.videoId}-${i}`}
                              track={track}
                              onPlay={() => playTrack(track)}
                              onAddToQueue={() => playTrack(track, true)}
                              isCurrent={currentTrack?.videoId === track.videoId}
                              isPlaying={isPlaying && currentTrack?.videoId === track.videoId}
                              isLiked={true}
                              onToggleLike={() => toggleLike(track)}
                              onAddToPlaylist={() => setAddToPlaylistTrack(track)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── PLAYLISTS TAB ─────────────────────────────────────── */}
                {libraryTab === 'playlists' && (
                  <div>
                    {/* Create new playlist */}
                    <div className="mb-4">
                      {showNewPlaylistInput ? (
                        <div className="flex gap-2">
                          <Input
                            value={newPlaylistName}
                            onChange={(e) => setNewPlaylistName(e.target.value)}
                            placeholder="Playlist name..."
                            className="flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') createPlaylist(newPlaylistName)
                              if (e.key === 'Escape') { setShowNewPlaylistInput(false); setNewPlaylistName('') }
                            }}
                          />
                          <Button size="sm" onClick={() => createPlaylist(newPlaylistName)}>
                            Create
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setShowNewPlaylistInput(false); setNewPlaylistName('') }}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowNewPlaylistInput(true)}
                          className="w-full border-dashed"
                        >
                          <Plus className="w-4 h-4 mr-1.5" />
                          New Playlist
                        </Button>
                      )}
                    </div>

                    {playlists.length === 0 ? (
                      <Card className="p-8 text-center border-dashed">
                        <ListMusic className="w-10 h-10 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
                        <p className="text-sm text-muted-foreground">No playlists yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Create a playlist to organize your music</p>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {playlists.map((pl) => (
                          <PlaylistCard
                            key={pl.id}
                            playlist={pl}
                            onPlay={() => {
                              if (pl.songs.length > 0) {
                                playTrack(pl.songs[0])
                                for (let i = 1; i < pl.songs.length; i++) {
                                  playTrack(pl.songs[i], true)
                                }
                              }
                            }}
                            onDelete={() => deletePlaylist(pl.id)}
                            onPlayTrack={(track) => playTrack(track)}
                            onAddToQueue={(track) => playTrack(track, true)}
                            currentTrackId={currentTrack?.videoId}
                            isPlaying={isPlaying}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Add to Playlist modal ──────────────────────────────────────── */}
        {addToPlaylistTrack && (
          <div
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setAddToPlaylistTrack(null)}
          >
            <div
              className="bg-card rounded-2xl border border-border/50 shadow-2xl max-w-sm w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-border/30">
                <h3 className="font-semibold text-sm">Add to playlist</h3>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{addToPlaylistTrack.title}</p>
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {playlists.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6 px-4">
                    No playlists yet. Go to Library → Playlists to create one.
                  </p>
                ) : (
                  playlists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => {
                        addToPlaylist(pl.id, addToPlaylistTrack)
                        setAddToPlaylistTrack(null)
                      }}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/50 transition-colors text-left"
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
                        <ListMusic className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{pl.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {pl.songs.length} song{pl.songs.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="p-2 border-t border-border/30">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setAddToPlaylistTrack(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Create Room dialog ─────────────────────────────────────────── */}
        {showCreateRoom && (
          <div
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowCreateRoom(false)}
          >
            <div
              className="bg-card rounded-2xl border border-border/50 shadow-2xl max-w-sm w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-border/30">
                <h3 className="font-semibold text-sm">Create Listening Room</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Invite friends to listen together</p>
              </div>
              <div className="p-4">
                <Input
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="Room name..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRoomName.trim()) {
                      createRoom.mutate(newRoomName)
                      setShowCreateRoom(false)
                    }
                    if (e.key === 'Escape') setShowCreateRoom(false)
                  }}
                />
              </div>
              <div className="flex gap-2 p-3 border-t border-border/30">
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => setShowCreateRoom(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!newRoomName.trim() || createRoom.isPending}
                  onClick={() => {
                    if (newRoomName.trim()) {
                      createRoom.mutate(newRoomName)
                      setShowCreateRoom(false)
                    }
                  }}
                >
                  {createRoom.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Invite to Room dialog ──────────────────────────────────────── */}
        <InviteDialog
          open={!!inviteTarget}
          onOpenChange={(open) => { if (!open) setInviteTarget(null) }}
          inviteType={inviteTarget?.type || 'music'}
          inviteContext={inviteTarget?.roomName ? `music room "${inviteTarget.roomName}"` : undefined}
          onSendInvite={async (targetUserId) => {
            if (!inviteTarget) return
            const res = await fetch('/api/invites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                targetUserId,
                type: inviteTarget.type,
                targetId: inviteTarget.roomId,
                roomName: inviteTarget.roomName,
              }),
            })
            if (!res.ok) throw new Error('Failed to send invite')
          }}
        />
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
  isLiked,
  onToggleLike,
  onAddToPlaylist,
}: {
  track: Track
  onPlay: () => void
  onAddToQueue: () => void
  isCurrent: boolean
  isPlaying: boolean
  isLiked?: boolean
  onToggleLike?: () => void
  onAddToPlaylist?: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 p-3 rounded-2xl transition-all group hover:bg-white/[0.04]',
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

      {/* Like button (heart) — always visible */}
      {onToggleLike && (
        <button
          onClick={onToggleLike}
          className={cn(
            'p-2.5 rounded-full transition-all shrink-0',
            isLiked
              ? 'text-red-400 hover:text-red-300'
              : 'text-muted-foreground hover:text-red-400 hover:bg-red-500/10'
          )}
          title={isLiked ? 'Remove from Liked' : 'Add to Liked'}
          aria-label={isLiked ? 'Remove from Liked' : 'Add to Liked'}
        >
          <Heart className={cn('w-5 h-5', isLiked && 'fill-current')} />
        </button>
      )}

      {/* Add to playlist button — always visible */}
      {onAddToPlaylist && (
        <button
          onClick={onAddToPlaylist}
          className="p-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shrink-0"
          title="Add to playlist"
          aria-label="Add to playlist"
        >
          <ListPlus className="w-5 h-5" />
        </button>
      )}

      {/* Add to queue button — always visible */}
      <button
        onClick={onAddToQueue}
        className="p-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all shrink-0"
        title="Add to queue"
        aria-label="Add to queue"
      >
        <Plus className="w-5 h-5" />
      </button>
    </div>
  )
}

// ─── Playlist Card (expandable) ────────────────────────────────────────────
function PlaylistCard({
  playlist,
  onPlay,
  onDelete,
  onPlayTrack,
  onAddToQueue,
  currentTrackId,
  isPlaying,
}: {
  playlist: Playlist
  onPlay: () => void
  onDelete: () => void
  onPlayTrack: (track: Track) => void
  onAddToQueue: (track: Track) => void
  currentTrackId?: string
  isPlaying: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 hover:bg-white/[0.02] transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
            <ListMusic className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold truncate">{playlist.name}</div>
            <div className="text-sm text-muted-foreground">
              {playlist.songs.length} song{playlist.songs.length !== 1 ? 's' : ''}
            </div>
          </div>
        </button>
        {playlist.songs.length > 0 && (
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onPlay} title="Play all">
            <Play className="w-4 h-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-red-400 hover:text-red-300" onClick={onDelete} title="Delete playlist">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Expanded track list */}
      {expanded && (
        <div className="px-2 pb-2 border-t border-border/30">
          {playlist.songs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Empty playlist — add songs from search or browse
            </p>
          ) : (
            <div className="space-y-1 pt-2">
              {playlist.songs.map((track, i) => (
                <TrackRow
                  key={`${track.videoId}-${i}`}
                  track={track}
                  onPlay={() => onPlayTrack(track)}
                  onAddToQueue={() => onAddToQueue(track)}
                  isCurrent={currentTrackId === track.videoId}
                  isPlaying={isPlaying && currentTrackId === track.videoId}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
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
  onInvite,
}: {
  room: Room
  isActive: boolean
  onJoin: () => void
  onDelete?: () => void
  onInvite?: () => void
}) {
  const confirm = useConfirm()
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
        {/* Invite button — sends a music room invitation to a user's DM */}
        {onInvite && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onInvite()
            }}
            className="shrink-0 p-2.5 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
            title="Invite to room"
            aria-label="Invite to room"
          >
            <ListPlus className="w-5 h-5" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={async (e) => {
              e.stopPropagation()
              const ok = await confirm({ title: `Delete room "${room.name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', variant: 'danger' })
              if (ok) onDelete()
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
