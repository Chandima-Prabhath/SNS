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
  Volume2, Loader2, Radio, Headphones, X, ChevronLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
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

export function MusicView() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [volume, setVolume] = useState(1)
  const audioRef = useRef<HTMLAudioElement>(null)
  const qc = useQueryClient()
  const { socket, connected } = useSocket()

  // Fetch trending tracks
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
      toast.success('Room created')
    },
  })

  // Search tracks
  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(searchQuery)}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setSearchResults(data.tracks || [])
    } catch (e: any) {
      toast.error(e.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  // Play a track
  const playTrack = useCallback(async (track: Track) => {
    setCurrentTrack(track)
    setIsPlaying(true)
    setPosition(0)

    // If in a room, update the room state
    if (activeRoomId) {
      fetch(`/api/music/rooms/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'track', videoId: track.videoId }),
      })
    }

    // Play the audio
    if (audioRef.current) {
      audioRef.current.src = `/api/music/stream/${track.videoId}`
      audioRef.current.volume = volume
      try {
        await audioRef.current.play()
      } catch (e: any) {
        // If the stream fails, check what went wrong
        if (e?.name === 'NotSupportedError' || e?.name === 'MediaError') {
          // The stream URL returned an error — fetch it to get the message
          try {
            const res = await fetch(`/api/music/stream/${track.videoId}`, { method: 'HEAD' })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              toast.error(data.error || 'This track could not be downloaded. YouTube may be blocking requests.')
              setCurrentTrack(null)
              setIsPlaying(false)
              return
            }
          } catch {
            // HEAD might not work, try a range request
          }
          toast.error('Could not play this track. The server might be downloading it — try again in a moment.')
        } else {
          toast.error('Click play again — browser autoplay policy')
        }
      }
    }
  }, [activeRoomId, volume])

  // Toggle play/pause
  const togglePlay = () => {
    if (!audioRef.current || !currentTrack) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
      if (activeRoomId) {
        fetch(`/api/music/rooms/${activeRoomId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause', position: audioRef.current.currentTime }),
        })
      }
    } else {
      audioRef.current.play()
      setIsPlaying(true)
      if (activeRoomId) {
        fetch(`/api/music/rooms/${activeRoomId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'play', position: audioRef.current.currentTime }),
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
      if (activeRoomId) {
        fetch(`/api/music/rooms/${activeRoomId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'seek', position: newPos }),
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
      setIsPlaying(false)
      setPosition(0)
    }
    const onError = () => {
      // The audio element failed to load — likely a stream error.
      // Fetch the stream URL to get the error message.
      if (currentTrack) {
        fetch(`/api/music/stream/${currentTrack.videoId}`)
          .then((res) => {
            if (!res.ok) return res.json()
            return null
          })
          .then((data) => {
            if (data?.error) {
              toast.error(data.error)
            } else {
              toast.error('Could not play this track. Try another song.')
            }
          })
          .catch(() => {
            toast.error('Could not play this track. The server might still be downloading it — try again in a moment.')
          })
        setCurrentTrack(null)
        setIsPlaying(false)
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
  }, [currentTrack])

  // Listen for room sync events
  useEffect(() => {
    if (!socket || !activeRoomId) return

    const onSync = (data: { roomId: string; state: string; position: number; videoId?: string }) => {
      if (data.roomId !== activeRoomId) return

      // Sync playback state
      if (data.videoId && (!currentTrack || currentTrack.videoId !== data.videoId)) {
        // Track changed — find the track info and play it
        // For now, create a minimal track object
        const track: Track = {
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
            audioRef.current.currentTime = data.position
            if (data.state === 'playing') {
              audioRef.current.play().catch(() => {})
              setIsPlaying(true)
            }
          }
        }, 100)
      } else if (audioRef.current) {
        // Just sync position/state
        const drift = Math.abs(audioRef.current.currentTime - data.position)
        if (drift > 1.5) {
          // Drift > 1.5s — force re-sync
          audioRef.current.currentTime = data.position
        }
        if (data.state === 'playing' && !isPlaying) {
          audioRef.current.play().catch(() => {})
          setIsPlaying(true)
        } else if (data.state === 'paused' && isPlaying) {
          audioRef.current.pause()
          setIsPlaying(false)
        }
      }
    }

    socket.on('music:sync', onSync)
    return () => {
      socket.off('music:sync', onSync)
    }
  }, [socket, activeRoomId, currentTrack, isPlaying])

  const trendingTracks = trendingData?.tracks || []
  const rooms = roomsData?.rooms || []
  const activeRoom = rooms.find((r: Room) => r.id === activeRoomId)

  return (
    <div className="h-full flex flex-col mesh-gradient overflow-hidden">
      {/* Hidden audio element */}
      <audio ref={audioRef} />

      {/* Main scrollable content */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
              <MusicIcon className="w-7 h-7 text-primary" />
              Musical
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Listen together in synced rooms · search and stream music
            </p>
          </div>

          {/* Active room banner */}
          {activeRoom && (
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-primary/10 border border-primary/20">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
                <Radio className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{activeRoom.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-3 h-3" />
                  {activeRoom.members.length} listening
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveRoomId(null)}
              >
                Leave
              </Button>
            </div>
          )}

          {/* Search */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search for songs, artists..."
                className="pl-9 h-11 bg-card/50 backdrop-blur-sm border-border/30"
              />
            </div>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Search Results
                </h2>
                <button
                  onClick={() => setSearchResults([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              <div className="grid gap-2">
                {searchResults.map((track) => (
                  <TrackCard
                    key={track.videoId}
                    track={track}
                    onPlay={() => playTrack(track)}
                    isCurrent={currentTrack?.videoId === track.videoId}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Rooms */}
          <section>
            <div className="flex items-center justify-between mb-3">
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
                Create
              </Button>
            </div>
            {rooms.length === 0 ? (
              <Card className="p-8 text-center border-dashed">
                <Headphones className="w-10 h-10 mx-auto text-muted-foreground mb-2" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">
                  No rooms yet. Create one to listen together.
                </p>
              </Card>
            ) : (
              <div className="grid gap-2">
                {rooms.map((room: Room) => (
                  <button
                    key={room.id}
                    onClick={() => setActiveRoomId(room.id)}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-xl text-left transition-colors border',
                      activeRoomId === room.id
                        ? 'bg-primary/10 border-primary/30'
                        : 'bg-card/50 border-border/30 hover:bg-accent/50'
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      room.currentState === 'playing'
                        ? 'bg-primary/20 text-primary pulse-glow'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      <Radio className={cn('w-4 h-4', room.currentState === 'playing' && 'animate-pulse')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{room.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{room.host?.displayName}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {room.members.length}
                        </span>
                        {room.currentState === 'playing' && (
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
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Trending */}
          {!searchResults.length && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Trending
              </h2>
              {trendingLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
                    <TrackCardGrid
                      key={track.videoId}
                      track={track}
                      onPlay={() => playTrack(track)}
                      isCurrent={currentTrack?.videoId === track.videoId}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Sticky bottom player bar */}
      <AnimatePresence>
        {currentTrack && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute bottom-0 left-0 right-0 z-20 glass-dark border-t border-border/50"
          >
            <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
              {/* Track info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
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
                  <div className="text-sm font-medium truncate">{currentTrack.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
                </div>
              </div>

              {/* Play/pause + skip */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={togglePlay}
                  size="icon"
                  className="rounded-full h-10 w-10 gradient-primary"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => {
                  setCurrentTrack(null)
                  setIsPlaying(false)
                  if (audioRef.current) audioRef.current.pause()
                }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Seek bar */}
              <div className="hidden md:flex items-center gap-2 shrink-0 w-48">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatTime(position)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={currentTrack.durationSeconds || 300}
                  value={position}
                  onChange={handleSeek}
                  className="flex-1 h-1 rounded-full bg-muted appearance-none cursor-pointer accent-primary"
                />
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatTime(currentTrack.durationSeconds || 0)}
                </span>
              </div>

              {/* Volume */}
              <div className="hidden lg:flex items-center gap-2 shrink-0 w-24">
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

function TrackCard({ track, onPlay, isCurrent }: { track: Track; onPlay: () => void; isCurrent: boolean }) {
  return (
    <button
      onClick={onPlay}
      className={cn(
        'flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors group',
        isCurrent ? 'bg-primary/10' : 'hover:bg-accent/50'
      )}
    >
      {track.thumbnail ? (
        <img src={track.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <MusicIcon className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={cn('text-sm font-medium truncate', isCurrent && 'text-primary')}>{track.title}</div>
        <div className="text-xs text-muted-foreground truncate">{track.artist}</div>
      </div>
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Play className="w-4 h-4 ml-0.5" />
      </div>
    </button>
  )
}

function TrackCardGrid({ track, onPlay, isCurrent }: { track: Track; onPlay: () => void; isCurrent: boolean }) {
  return (
    <button
      onClick={onPlay}
      className={cn(
        'group relative rounded-xl overflow-hidden text-left transition-all',
        isCurrent ? 'ring-2 ring-primary' : 'hover:scale-[1.02]'
      )}
    >
      {track.thumbnail ? (
        <div className="aspect-square relative">
          <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
            <div className="w-12 h-12 rounded-full gradient-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-glow">
              <Play className="w-5 h-5 text-primary-foreground ml-0.5" />
            </div>
          </div>
        </div>
      ) : (
        <div className="aspect-square bg-muted flex items-center justify-center">
          <MusicIcon className="w-8 h-8 text-muted-foreground" />
        </div>
      )}
      <div className="p-2 bg-card">
        <div className={cn('text-xs font-medium truncate', isCurrent && 'text-primary')}>{track.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">{track.artist}</div>
      </div>
    </button>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
