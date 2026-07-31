'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search, Play, X, Star, Calendar, Clock, ChevronLeft, ChevronRight,
  Film, Tv, TrendingUp, Loader2, Sparkles, Heart, Plus, ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { tmdbImage, tmdbBackdrop } from '@/lib/tmdb'
import { getAggregatorsForType, type Aggregator } from '@/lib/streaming-aggregators'
import { GradientText, GlassSurface, ShinyText } from '@/components/reactbits'

interface MediaItem {
  id: number
  title?: string
  name?: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date?: string | null
  first_air_date?: string | null
  vote_average: number
  media_type?: string
}

interface DetailData {
  id: number
  title?: string
  name?: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date?: string | null
  first_air_date?: string | null
  vote_average: number
  runtime?: number
  number_of_seasons?: number
  number_of_episodes?: number
  genres?: { id: number; name: string }[]
  credits?: { cast: any[] }
  seasons?: { id: number; name: string; season_number: number; episode_count: number; poster_path: string }[]
  imdb_id?: string
  recommendations?: { results: MediaItem[] }
}

type BrowseTab = 'trending' | 'movies' | 'tv' | 'top-rated'

export function CinemaView() {
  const [browseTab, setBrowseTab] = useState<BrowseTab>('trending')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MediaItem[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedItem, setSelectedItem] = useState<{ id: number; type: 'movie' | 'tv' } | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)

  const { data: trendingData, isLoading: trendingLoading } = useQuery({
    queryKey: ['cinema-trending'],
    queryFn: async () => {
      const res = await fetch('/api/cinema/trending?category=trending')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const { data: popularMovies } = useQuery({
    queryKey: ['cinema-popular-movies'],
    queryFn: async () => {
      const res = await fetch('/api/cinema/trending?category=popular-movies')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const { data: popularTv } = useQuery({
    queryKey: ['cinema-popular-tv'],
    queryFn: async () => {
      const res = await fetch('/api/cinema/trending?category=popular-tv')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const { data: topRated } = useQuery({
    queryKey: ['cinema-top-rated'],
    queryFn: async () => {
      const res = await fetch('/api/cinema/trending?category=top-rated-movies')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (searchAbortRef.current) { searchAbortRef.current.abort(); searchAbortRef.current = null }
    if (!value.trim()) { setSearchResults([]); setSearching(false); return }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true)
      const controller = new AbortController()
      searchAbortRef.current = controller
      try {
        const res = await fetch(`/api/cinema/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        if (!res.ok) return
        const data = await res.json()
        if (searchAbortRef.current === controller) {
          setSearchResults((data.results || []).filter((r: MediaItem) => r.media_type === 'movie' || r.media_type === 'tv'))
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return
      } finally {
        if (searchAbortRef.current === controller) { setSearching(false); searchAbortRef.current = null }
      }
    }, 400)
  }

  const trendingItems: MediaItem[] = trendingData?.results || []
  const heroItem = trendingItems[0]

  if (selectedItem) {
    return <DetailView item={selectedItem} onBack={() => setSelectedItem(null)} />
  }

  if (searchQuery.trim() && searchResults.length > 0) {
    return (
      <div className="h-full overflow-y-auto px-4 pt-4 pb-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => { setSearchQuery(''); setSearchResults([]) }} className="p-2 rounded-xl hover:bg-white/5 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold">Search: "{searchQuery}"</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {searchResults.map((item) => (
              <MediaCard key={`${item.media_type}-${item.id}`} item={item} onClick={() => setSelectedItem({ id: item.id, type: item.media_type as 'movie' | 'tv' })} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      {heroItem && !searchQuery.trim() && (
        <HeroBanner item={heroItem} onPlay={() => setSelectedItem({ id: heroItem.id, type: (heroItem.media_type || 'movie') as 'movie' | 'tv' })} />
      )}

      <div className="max-w-5xl mx-auto px-4 pb-8">
        <div className="relative mb-6 -mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search movies & TV shows..."
            className="pl-10 glass-dark border-white/10"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex gap-1 p-1 bg-muted/50 rounded-lg w-fit mb-6">
          {([
            ['trending', 'Trending', TrendingUp],
            ['movies', 'Movies', Film],
            ['tv', 'TV Shows', Tv],
            ['top-rated', 'Top Rated', Star],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setBrowseTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                browseTab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {trendingLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {browseTab === 'trending' && (
              <>
                <ContentRow title="Trending This Week" items={trendingItems} onSelect={(item) => setSelectedItem({ id: item.id, type: (item.media_type || 'movie') as 'movie' | 'tv' })} />
                {popularMovies?.results && <ContentRow title="Popular Movies" items={popularMovies.results} onSelect={(item) => setSelectedItem({ id: item.id, type: 'movie' })} />}
                {popularTv?.results && <ContentRow title="Popular TV Shows" items={popularTv.results} onSelect={(item) => setSelectedItem({ id: item.id, type: 'tv' })} />}
              </>
            )}
            {browseTab === 'movies' && (
              <ContentRow title="Popular Movies" items={popularMovies?.results || []} onSelect={(item) => setSelectedItem({ id: item.id, type: 'movie' })} />
            )}
            {browseTab === 'tv' && (
              <ContentRow title="Popular TV Shows" items={popularTv?.results || []} onSelect={(item) => setSelectedItem({ id: item.id, type: 'tv' })} />
            )}
            {browseTab === 'top-rated' && (
              <ContentRow title="Top Rated Movies" items={topRated?.results || []} onSelect={(item) => setSelectedItem({ id: item.id, type: 'movie' })} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function HeroBanner({ item, onPlay }: { item: MediaItem; onPlay: () => void }) {
  const backdrop = tmdbBackdrop(item.backdrop_path, 'w1280') || tmdbImage(item.poster_path, 'w780')
  const title = item.title || item.name || 'Unknown'

  return (
    <div className="relative h-[50vh] min-h-[300px] w-full overflow-hidden">
      <img src={backdrop || ''} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded-md bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-wider">
              {item.media_type === 'tv' ? 'TV Show' : 'Movie'}
            </span>
            {item.vote_average > 0 && (
              <span className="flex items-center gap-1 text-xs text-foreground/70">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                {item.vote_average.toFixed(1)}
              </span>
            )}
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-3 line-clamp-2">{title}</h1>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4 max-w-lg">{item.overview}</p>
          <Button onClick={onPlay} size="sm" className="rounded-xl px-6">
            <Play className="w-4 h-4 mr-1.5 fill-current" />
            Watch Now
          </Button>
        </motion.div>
      </div>
    </div>
  )
}

function ContentRow({ title, items, onSelect }: { title: string; items: MediaItem[]; onSelect: (item: MediaItem) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir === 'left' ? -400 : 400, behavior: 'smooth' })
  }
  if (!items.length) return null

  return (
    <div className="mb-8 group/row">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground/80">
          <ShinyText shimmerDuration={4} className="text-sm">{title}</ShinyText>
        </h2>
        <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button onClick={() => scroll('left')} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => scroll('right')} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        {items.map((item) => (
          <MediaCard key={`${item.id}-${item.media_type || 'movie'}`} item={item} onClick={() => onSelect(item)} compact />
        ))}
      </div>
    </div>
  )
}

function MediaCard({ item, onClick, compact }: { item: MediaItem; onClick: () => void; compact?: boolean }) {
  const poster = tmdbImage(item.poster_path, 'w342')
  const title = item.title || item.name || 'Unknown'
  const date = item.release_date || item.first_air_date

  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-xl overflow-hidden group/card transition-all hover:scale-105 hover:shadow-xl',
        compact ? 'w-32 md:w-36' : 'w-full'
      )}
    >
      <div className="relative aspect-[2/3] bg-muted rounded-xl overflow-hidden">
        {poster ? (
          <img src={poster} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="w-8 h-8 text-white fill-white" />
        </div>
        {item.vote_average > 0 && (
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-bold flex items-center gap-0.5">
            <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
            {item.vote_average.toFixed(1)}
          </div>
        )}
      </div>
      <div className="pt-2 px-0.5">
        <div className="text-xs font-medium truncate">{title}</div>
        {date && <div className="text-[10px] text-muted-foreground">{date.slice(0, 4)}</div>}
      </div>
    </button>
  )
}

function DetailView({ item, onBack }: { item: { id: number; type: 'movie' | 'tv' }; onBack: () => void }) {
  const [playing, setPlaying] = useState(false)
  const [aggregator, setAggregator] = useState<Aggregator | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [selectedEpisode, setSelectedEpisode] = useState(1)

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['cinema-detail', item.type, item.id],
    queryFn: async () => {
      const endpoint = item.type === 'movie' ? `/api/cinema/movie/${item.id}` : `/api/cinema/tv/${item.id}`
      const res = await fetch(endpoint)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const detail: DetailData | undefined = detailData?.[item.type] || detailData?.movie || detailData?.tv
  const aggregators = getAggregatorsForType(item.type)

  const handlePlay = () => {
    setAggregator(aggregators[0])
    setPlaying(true)
  }

  if (playing && aggregator && detail) {
    const embedUrl = item.type === 'movie'
      ? aggregator.movieUrl(item.id, detail.imdb_id)
      : aggregator.tvUrl(item.id, selectedSeason, selectedEpisode)

    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-3 p-3 border-b border-border/30">
          <button onClick={() => setPlaying(false)} className="p-2 rounded-xl hover:bg-white/5 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">
              {detail.title || detail.name}
              {item.type === 'tv' && ` — S${selectedSeason} E${selectedEpisode}`}
            </div>
          </div>
        </div>

        <div className="flex gap-1.5 p-3 border-b border-border/30 overflow-x-auto">
          {aggregators.map((agg) => (
            <button
              key={agg.id}
              onClick={() => setAggregator(agg)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0',
                aggregator.id === agg.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10'
              )}
            >
              {agg.name}
              <span className="ml-1.5 text-[10px] opacity-60">{agg.quality}</span>
            </button>
          ))}
        </div>

        {item.type === 'tv' && detail.seasons && (
          <div className="flex gap-2 p-3 border-b border-border/30">
            <select
              value={selectedSeason}
              onChange={(e) => { setSelectedSeason(parseInt(e.target.value, 10)); setSelectedEpisode(1) }}
              className="bg-[#1e1f22] border border-white/10 rounded-lg px-3 py-1.5 text-xs"
            >
              {detail.seasons.filter((s) => s.season_number > 0).map((s) => (
                <option key={s.id} value={s.season_number}>Season {s.season_number}</option>
              ))}
            </select>
            <select
              value={selectedEpisode}
              onChange={(e) => setSelectedEpisode(parseInt(e.target.value, 10))}
              className="bg-[#1e1f22] border border-white/10 rounded-lg px-3 py-1.5 text-xs"
            >
              {Array.from({ length: detail.seasons.find((s) => s.season_number === selectedSeason)?.episode_count || 10 }, (_, i) => (
                <option key={i} value={i + 1}>Episode {i + 1}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 relative bg-black">
          <iframe
            key={embedUrl}
            src={embedUrl}
            className="absolute inset-0 w-full h-full"
            frameBorder="0"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    )
  }

  if (isLoading || !detail) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  const backdrop = tmdbBackdrop(detail.backdrop_path, 'w1280') || tmdbImage(detail.poster_path, 'w780')
  const poster = tmdbImage(detail.poster_path, 'w342')
  const title = detail.title || detail.name || 'Unknown'
  const date = detail.release_date || detail.first_air_date
  const cast = detail.credits?.cast?.slice(0, 8) || []

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative h-[40vh] min-h-[250px]">
        <img src={backdrop || ''} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-xl glass-dark border-white/10 z-10">
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4 -mt-20 relative z-10 pb-8">
        <div className="flex gap-5">
          <div className="w-28 md:w-36 shrink-0 -mt-8">
            {poster && <img src={poster} alt="" className="w-full rounded-xl shadow-2xl ring-1 ring-white/10" />}
          </div>
          <div className="flex-1 min-w-0 pt-4">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight mb-2">{title}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
              {date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{date.slice(0, 4)}</span>}
              {detail.vote_average > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />{detail.vote_average.toFixed(1)}</span>}
              {detail.runtime && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{detail.runtime}m</span>}
              {detail.number_of_seasons && <span>{detail.number_of_seasons} season{detail.number_of_seasons !== 1 ? 's' : ''}</span>}
            </div>
            {detail.genres && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {detail.genres.map((g) => (
                  <span key={g.id} className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] text-muted-foreground">{g.name}</span>
                ))}
              </div>
            )}
            <Button onClick={handlePlay} className="rounded-xl px-6 mb-4">
              <Play className="w-4 h-4 mr-1.5 fill-current" />
              Play
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed mb-6 mt-2">{detail.overview}</p>

        {cast.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Cast</h3>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {cast.map((person) => (
                <div key={person.id} className="shrink-0 w-20 text-center">
                  <div className="w-20 h-20 rounded-full overflow-hidden mb-1.5 ring-1 ring-white/10">
                    {person.profile_path ? (
                      <img src={tmdbImage(person.profile_path, 'w185') || ''} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center">
                        <span className="text-lg font-bold text-muted-foreground">{person.name.charAt(0)}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] font-medium truncate">{person.name}</div>
                  <div className="text-[9px] text-muted-foreground truncate">{person.character}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {detail.recommendations?.results && detail.recommendations.results.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">More Like This</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {detail.recommendations!.results.slice(0, 10).map((rec) => (
                <MediaCard key={rec.id} item={rec} onClick={() => {
                  window.location.hash = `#cinema-${rec.media_type || item.type}-${rec.id}`
                  window.location.reload()
                }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
