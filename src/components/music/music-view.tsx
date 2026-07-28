'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import {
  Search, Play, Pause, SkipForward, Plus, Users, Music as MusicIcon,
  Volume2, Loader2, Radio, Headphones, X, ListMusic, Compass,
  Trash2, Repeat, Shuffle, Heart,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSocket } from '@/hooks/useSocket'

interface Track {
  videoId: string
  title: string
  artist: string
  thumbnail: string | null
  durationSeconds: number | null
  album?: string | null
}

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

export function MusicView() {
  const [tab, setTab] = useState<Tab>('browse')
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [queue, setQueue] = useState<Track[]>([])
  const [autoplay, setAutoplay] = useState(true)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qc = useQueryClient()
  const { socket } = useSocket()

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
  const { data: roomsData, refetch: refetchRooms } = useQuery({
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

  // Play a track
  const playTrack = useCallback(async (track: Track, addToQueue = false) => {
    if (addToQueue && currentTrack) {
      setQueue((q) => [...q, track])
      toast.success(`Added to queue: ${track.title}`)
      return
    }

    setCurrentTrack(track)
    setIsPlaying(true)
    setPosition(0)

    // If in a room, broadcast the track change to all members via Socket.io
    if (activeRoomId && socket) {
      socket.emit('music:sync', {
        roomId: activeRoomId,
        state: 'playing',
        position: 0,
        videoId: track.videoId,
        trackInfo: {
          title: track.title,
          artist: track.artist,
          thumbnail: track.thumbnail,
          durationSeconds: track.durationSeconds,
        },
      })
    }

    if (audioRef.current) {
      audioRef.current.src = `/api/music/stream/${track.videoId}`
      audioRef.current.volume = volume
      try {
        await audioRef.current.play()
      } catch (e: any) {
        if (e?.name === 'NotSupportedError' || e?.name === 'MediaError') {
          try {
            const res = await fetch(`/api/music/stream/${track.videoId}`, { method: 'HEAD' })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              toast.error(data.error || 'Could not download this track.')
              setCurrentTrack(null)
              setIsPlaying(false)
            }
          } catch {
            toast.error('The server is downloading this track — try again in a moment.')
          }
        }
      }
    }
  }, [activeRoomId, volume, currentTrack, socket])

  // Play next track from queue or autoplay
  const playNext = useCallback(async () => {
    let nextTrack: Track | null = null

    if (queue.length > 0) {
      if (shuffle) {
        const idx = Math.floor(Math.random() * queue.length)
        nextTrack = queue[idx]
        setQueue((q) => q.filter((_, i) => i !== idx))
      } else {
        nextTrack = queue[0]
        setQueue((q) => q.slice(1))
      }
    } else if (autoplay && currentTrack) {
      // Fetch related tracks and play the first one
      try {
        const res = await fetch(`/api/music/related/${currentTrack.videoId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.tracks?.length > 0) {
            nextTrack = data.tracks[0]
          }
        }
      } catch {
        // Autoplay failed — just stop
      }
    }

    if (nextTrack) {
      await playTrack(nextTrack)
    } else if (repeat && currentTrack) {
      await playTrack(currentTrack)
    } else {
      setIsPlaying(false)
      setPosition(0)
    }
  }, [queue, shuffle, autoplay, currentTrack, repeat, playTrack])

  // Toggle play/pause
  const togglePlay = () => {
    if (!audioRef.current || !currentTrack) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
      // Broadcast pause to room
      if (activeRoomId && socket) {
        socket.emit('music:sync', {
          roomId: activeRoomId,
          state: 'paused',
          position: audioRef.current.currentTime,
        })
      }
    } else {
      audioRef.current.play()
      setIsPlaying(true)
      // Broadcast play to room
      if (activeRoomId && socket) {
        socket.emit('music:sync', {
          roomId: activeRoomId,
          state: 'playing',
          position: audioRef.current.currentTime,
        })
      }
    }
  }

  // Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPos = parseFloat(e.target.value)
    if (audioRef.current) {
      audioRef.current.currentTime = newPos
      setPosition(newPos)
      // Broadcast seek to room
      if (activeRoomId && socket) {
        socket.emit('music:sync', {
          roomId: activeRoomId,
          state: isPlaying ? 'playing' : 'paused',
          position: newPos,
        })
      }
    }
  }

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setPosition(audio.currentTime)
    const onEnded = () => {
      // Auto-play next track when current ends
      playNext()
    }
    const onError = () => {
      if (currentTrack) {
        // Skip to next on error
        toast.error('Could not play this track — skipping...')
        setQueue((q) => q.slice(1))
        playNext()
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
  }, [currentTrack, playNext])

  // Real-time sync: listen for room sync events from the host.
  // This is the CORE of sync play — when the host plays/pauses/seeks/changes
  // track, the event arrives instantly via Socket.io (not DB polling).
  useEffect(() => {
    if (!socket || !activeRoomId) return

    // Join the music room's socket channel
    socket.emit('music:join', activeRoomId)

    // Request the host's current state immediately after joining
    setTimeout(() => {
      socket.emit('music:request-sync', activeRoomId)
    }, 500)

    const onSync = (data: {
      roomId: string
      state: string
      position: number
      videoId?: string
      trackInfo?: Track
      serverTimestamp: number
    }) => {
      if (data.roomId !== activeRoomId) return

      // Calculate network delay and adjust position
      const networkDelay = (Date.now() - data.serverTimestamp) / 1000
      const adjustedPosition = data.position + (data.state === 'playing' ? networkDelay : 0)

      // Track changed — load the new track and sync to host's position
      if (data.videoId && (!currentTrack || currentTrack.videoId !== data.videoId)) {
        const track: Track = data.trackInfo || {
          videoId: data.videoId,
          title: 'Now Playing',
          artist: '',
          thumbnail: null,
          durationSeconds: null,
        }
        setCurrentTrack(track)
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.src = `/api/music/stream/${data.videoId}`
            // Set the position to match the host's current position
            audioRef.current.currentTime = adjustedPosition
            if (data.state === 'playing') {
              audioRef.current.play().catch(() => {})
              setIsPlaying(true)
            } else {
              setIsPlaying(false)
            }
          }
        }, 200)
      } else if (audioRef.current && currentTrack) {
        // Same track — just sync position and state
        const drift = Math.abs(audioRef.current.currentTime - adjustedPosition)

        // Only force-seek if drift > 1.5 seconds (avoid jitter from minor differences)
        if (drift > 1.5) {
          audioRef.current.currentTime = adjustedPosition
        }

        // Sync play/pause state
        if (data.state === 'playing' && !isPlaying) {
          audioRef.current.play().catch(() => {})
          setIsPlaying(true)
        } else if (data.state === 'paused' && isPlaying) {
          audioRef.current.pause()
          setIsPlaying(false)
        }
      }
    }

    // When the host receives a sync request, broadcast current state
    const onRequestSync = (data: { roomId: string; fromUserId: string }) => {
      if (data.roomId !== activeRoomId) return
      // Only the host responds to sync requests
      if (currentTrack && socket) {
        socket.emit('music:sync', {
          roomId: activeRoomId,
          state: isPlaying ? 'playing' : 'paused',
          position: audioRef.current?.currentTime || 0,
          videoId: currentTrack.videoId,
          trackInfo: {
            title: currentTrack.title,
            artist: currentTrack.artist,
            thumbnail: currentTrack.thumbnail,
            durationSeconds: currentTrack.durationSeconds,
          },
        })
      }
    }

    socket.on('music:sync', onSync)
    socket.on('music:request-sync', onRequestSync)

    return () => {
      socket.off('music:sync', onSync)
      socket.off('music:request-sync', onRequestSync)
      socket.emit('music:leave', activeRoomId)
    }
  }, [socket, activeRoomId, currentTrack, isPlaying])

  // Delete room
  const deleteRoom = useMutation({
    mutationFn: async (roomId: string) => {
      const res = await fetch(`/api/music/rooms/${roomId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music-rooms'] })
      if (activeRoomId) setActiveRoomId(null)
      toast.success('Room deleted')
    },
    onError: () => toast.error('Failed to delete room'),
  })

  const trendingTracks = trendingData?.tracks || []
  const rooms = roomsData?.rooms || []
  const activeRoom = rooms.find((r: Room) => r.id === activeRoomId)

  return (
    <div className="h-full flex flex-col mesh-gradient overflow-hidden">
      <audio ref={audioRef} />

      {/* Header with tabs */}
      <div className="shrink-0 px-4 pt-4 pb-2 border-b border-border/30">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2 mb-3">
            <MusicIcon className="w-7 h-7 text-primary" />
            Musical
          </h1>

          {/* Tab navigation */}
          <div className="flex gap-1 p-1 bg-muted/50 rounded-xl max-w-xs">
            {([
              ['browse', 'Browse', Compass],
              ['rooms', 'Rooms', Radio],
              ['queue', 'Queue', ListMusic],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all',
                  tab === key
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {key === 'queue' && queue.length > 0 && (
                  <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                    {queue.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content area */}
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
                        isPlaying={isPlaying && currentTrack?.videoId === track.videoId}
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
                              isPlaying={isPlaying && currentTrack?.videoId === track.videoId}
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
                    <Headphones className="w-12 h-12 mx-auto text-muted-foreground mb-3" strokeWidth={1.5} />
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
                          // Just set the active room — the Socket.io sync
                          // effect will join the socket channel and request
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
                      onClick={() => setQueue([])}
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
                        <img src={currentTrack.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg gradient-primary flex items-center justify-center">
                          <MusicIcon className="w-5 h-5 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{currentTrack.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setShuffle(!shuffle)}
                          className={cn('p-2 rounded-lg transition-colors', shuffle ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
                        >
                          <Shuffle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setRepeat(!repeat)}
                          className={cn('p-2 rounded-lg transition-colors', repeat ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
                        >
                          <Repeat className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setAutoplay(!autoplay)}
                          className={cn('p-2 rounded-lg transition-colors', autoplay ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
                          title="Autoplay recommendations"
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
                    <ListMusic className="w-10 h-10 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
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
                        <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                        {track.thumbnail ? (
                          <img src={track.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                            <MusicIcon className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{track.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{track.artist}</div>
                        </div>
                        <button
                          onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                          className="p-1.5 rounded-lg text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Sticky bottom player bar — positioned above bottom nav on mobile */}
      <AnimatePresence>
        {currentTrack && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute bottom-14 lg:bottom-0 left-0 right-0 z-20 bg-popover/95 backdrop-blur-2xl border-t border-border/50 shadow-2xl"
          >
            {/* Mobile layout: compact — track info + play/pause only */}
            <div className="lg:hidden px-3 py-2.5 flex items-center gap-3">
              {currentTrack.thumbnail ? (
                <img src={currentTrack.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center shrink-0">
                  <MusicIcon className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{currentTrack.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{currentTrack.artist}</div>
                {/* Seek bar below track info on mobile */}
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[8px] text-muted-foreground tabular-nums">{formatTime(position)}</span>
                  <input
                    type="range"
                    min={0}
                    max={currentTrack.durationSeconds || 300}
                    value={position}
                    onChange={handleSeek}
                    className="flex-1 h-0.5 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
                  />
                  <span className="text-[8px] text-muted-foreground tabular-nums">{formatTime(currentTrack.durationSeconds || 0)}</span>
                </div>
              </div>
              <Button onClick={togglePlay} size="icon" className="rounded-full h-9 w-9 shrink-0 gradient-primary">
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </Button>
              <Button onClick={playNext} variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-foreground">
                <SkipForward className="w-4 h-4" />
              </Button>
            </div>

            {/* Desktop layout: full — track info + seek bar + controls + volume */}
            <div className="hidden lg:flex max-w-5xl mx-auto px-4 py-2.5 items-center gap-4">
              {/* Track info */}
              <div className="flex items-center gap-3 min-w-0 w-64 shrink-0">
                {currentTrack.thumbnail ? (
                  <img src={currentTrack.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg gradient-primary flex items-center justify-center shrink-0">
                    <MusicIcon className="w-5 h-5 text-primary-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{currentTrack.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
                </div>
              </div>

              {/* Seek bar + controls (center, flexible) */}
              <div className="flex-1 flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-3">
                  <Button onClick={playNext} variant="ghost" size="icon" className="h-8 w-8 text-foreground hover:bg-accent">
                    <Shuffle className="w-3.5 h-3.5" />
                  </Button>
                  <Button onClick={playNext} variant="ghost" size="icon" className="h-8 w-8 text-foreground hover:bg-accent">
                    <SkipForward className="w-4 h-4" />
                  </Button>
                  <Button onClick={togglePlay} size="icon" className="rounded-full h-10 w-10 gradient-primary shadow-glow hover:scale-105 transition-transform">
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </Button>
                  <Button
                    onClick={() => { setCurrentTrack(null); setIsPlaying(false); if (audioRef.current) audioRef.current.pause() }}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-foreground hover:bg-accent"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <Button onClick={() => setRepeat(!repeat)} variant="ghost" size="icon" className={cn('h-8 w-8 hover:bg-accent', repeat ? 'text-primary' : 'text-foreground')}>
                    <Repeat className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 w-full max-w-md">
                  <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">{formatTime(position)}</span>
                  <input
                    type="range"
                    min={0}
                    max={currentTrack.durationSeconds || 300}
                    value={position}
                    onChange={handleSeek}
                    className="flex-1 h-1 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
                  />
                  <span className="text-[10px] text-muted-foreground tabular-nums w-8">{formatTime(currentTrack.durationSeconds || 0)}</span>
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
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setVolume(v)
                    if (audioRef.current) audioRef.current.volume = v
                  }}
                  className="flex-1 h-1 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Track Row (list view) ─────────────────────────────────────────────────
function TrackRow({
  track, onPlay, onAddToQueue, isCurrent, isPlaying,
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
        isCurrent ? 'bg-primary/10' : 'hover:bg-accent/50'
      )}
    >
      <button onClick={onPlay} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        {track.thumbnail ? (
          <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0">
            <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {isCurrent && isPlaying ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white ml-0.5" />}
            </div>
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <MusicIcon className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm font-medium truncate', isCurrent && 'text-primary')}>{track.title}</div>
          <div className="text-xs text-muted-foreground truncate">{track.artist}</div>
        </div>
      </button>
      <button
        onClick={onAddToQueue}
        className="p-2 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition-all"
        title="Add to queue"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── Track Card (grid view) ────────────────────────────────────────────────
function TrackCard({
  track, onPlay, onAddToQueue, isCurrent, isPlaying,
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
        'group relative rounded-xl overflow-hidden text-left transition-all',
        isCurrent ? 'ring-2 ring-primary' : 'hover:scale-[1.02]'
      )}
    >
      <button onClick={onPlay} className="w-full">
        {track.thumbnail ? (
          <div className="aspect-square relative">
            <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
              <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-glow">
                {isCurrent && isPlaying ? <Pause className="w-5 h-5 text-primary-foreground" /> : <Play className="w-5 h-5 text-primary-foreground ml-0.5" />}
              </div>
            </div>
          </div>
        ) : (
          <div className="aspect-square bg-muted flex items-center justify-center">
            <MusicIcon className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </button>
      <div className="p-2 bg-card flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <div className={cn('text-xs font-medium truncate', isCurrent && 'text-primary')}>{track.title}</div>
          <div className="text-[10px] text-muted-foreground truncate">{track.artist}</div>
        </div>
        <button
          onClick={onAddToQueue}
          className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary transition-all shrink-0"
          title="Add to queue"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Room Card ─────────────────────────────────────────────────────────────
function RoomCard({ room, isActive, onJoin, onDelete }: { room: Room; isActive: boolean; onJoin: () => void; onDelete?: () => void }) {
  const isPlaying = room.currentState === 'playing'
  return (
    <div
      className={cn(
        'w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all border group',
        isActive
          ? 'bg-primary/10 border-primary/30 shadow-glow'
          : 'bg-card/50 border-border/30 hover:bg-accent/50 hover:border-primary/20'
      )}
    >
      <button onClick={onJoin} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div className={cn(
          'w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all',
          isPlaying ? 'bg-primary/20 text-primary pulse-glow' : 'bg-muted text-muted-foreground'
        )}>
          <Radio className={cn('w-5 h-5', isPlaying && 'animate-pulse')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{room.name}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>Hosted by {room.host?.displayName || 'Unknown'}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {room.members.length}
            </span>
            {isPlaying && (
              <>
                <span>·</span>
                <span className="text-status-online flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-online animate-pulse" />
                  Live
                </span>
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
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
