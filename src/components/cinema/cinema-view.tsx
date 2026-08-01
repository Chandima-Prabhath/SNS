'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search, Play, X, Star, Calendar, Clock, ChevronLeft, ChevronRight,
  Film, Tv, TrendingUp, Loader2, Sparkles, Heart, Plus, ArrowLeft,
  Flame, Award, Bookmark, Info, Zap, Maximize2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { tmdbImage, tmdbBackdrop } from '@/lib/tmdb'
import { getAggregatorsForType, type Aggregator, IFRAME_SANDBOX, IFRAME_ALLOW } from '@/lib/streaming-aggregators'
import {
  GradientText, GlassSurface, ShinyText, SpotlightCard, BorderGlow,
  TiltedCard, Meteors, AnimatedGradientText, Counter, ShimmerLine, PulseBeam, StarBorder,
} from '@/components/reactbits'

// ─── Types ──────────────────────────────────────────────────────────────────

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
  tagline?: string
  status?: string
}

type BrowseTab = 'trending' | 'movies' | 'tv' | 'top-rated'

// ─── Main View ──────────────────────────────────────────────────────────────

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

  const handleSearchChange = useCallback((value: string) => {
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
  }, [])

  // Detail view
  if (selectedItem) {
    return <DetailView item={selectedItem} onBack={() => setSelectedItem(null)} />
  }

  // Search results
  if (searchQuery.trim() && searchResults.length > 0) {
    return (
      <div className="h-full overflow-y-auto gradient-cinematic">
        <Meteors count={12} className="opacity-30" />
        <div className="relative px-4 pt-4 pb-8">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-8">
              <button
                onClick={() => { setSearchQuery(''); setSearchResults([]) }}
                className="p-2.5 rounded-xl glass-dark border-white/10 hover:scale-105 transition-transform"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Search Results</div>
                <h2 className="text-xl font-bold">
                  <AnimatedGradientText className="font-black">{searchQuery}</AnimatedGradientText>
                </h2>
              </div>
              <div className="ml-auto text-xs text-muted-foreground">{searchResults.length} results</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {searchResults.map((item) => (
                <MediaCard
                  key={`${item.media_type}-${item.id}`}
                  item={item}
                  onClick={() => setSelectedItem({ id: item.id, type: item.media_type as 'movie' | 'tv' })}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Empty search state (typed but no results yet)
  if (searchQuery.trim() && !searching && searchResults.length === 0) {
    return (
      <div className="h-full overflow-y-auto gradient-cinematic flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-bold mb-1">No matches for "{searchQuery}"</h3>
          <p className="text-sm text-muted-foreground">Try a different title or check spelling.</p>
        </div>
      </div>
    )
  }

  const trendingItems: MediaItem[] = trendingData?.results || []
  const heroItems = trendingItems.slice(0, 5)

  return (
    <div className="h-full overflow-y-auto gradient-cinematic cinema-scroll">
      {/* ─── Cinematic Hero Carousel ─────────────────────────────────────── */}
      {heroItems.length > 0 && (
        <HeroCarousel
          items={heroItems}
          onSelect={(item) => setSelectedItem({ id: item.id, type: (item.media_type || 'movie') as 'movie' | 'tv' })}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 pb-12 relative z-10">
        {/* ─── Cinematic Search Bar ──────────────────────────────────────── */}
        <div className="relative mb-8 -mt-2">
          <GlassSurface blur={24} opacity={0.05} className="rounded-2xl">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search for movies, TV shows, actors..."
                className="pl-11 pr-12 h-12 bg-transparent border-0 text-base placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-primary/40"
              />
              {searching ? (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />
              ) : searchQuery ? (
                <button
                  onClick={() => handleSearchChange('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              ) : (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md bg-white/5 text-[10px] font-mono text-muted-foreground border border-white/10">
                  /
                </div>
              )}
            </div>
          </GlassSurface>
        </div>

        {/* ─── Browse Tabs ───────────────────────────────────────────────── */}
        <div className="flex gap-1 p-1 glass-dark rounded-2xl w-full sm:w-fit mb-6 sm:mb-8 overflow-x-auto cinema-row-scroll">
          {([
            ['trending', 'Trending', TrendingUp, Flame],
            ['movies', 'Movies', Film, Film],
            ['tv', 'TV Shows', Tv, Tv],
            ['top-rated', 'Top Rated', Star, Award],
          ] as const).map(([key, label, Icon, ActiveIcon]) => (
            <button
              key={key}
              onClick={() => setBrowseTab(key)}
              className={cn(
                'relative flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 shrink-0 flex-1 sm:flex-initial',
                browseTab === key
                  ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-glow'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              )}
            >
              {browseTab === key ? <ActiveIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {/* ─── Content ──────────────────────────────────────────────────── */}
        {trendingLoading ? (
          <CinemaSkeletonLoader />
        ) : (
          <>
            {browseTab === 'trending' && (
              <>
                {/* Stats strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                  <StatCard icon={Flame} label="Trending Now" value={trendingItems.length} color="oklch(0.66 0.22 25)" />
                  <StatCard icon={Film} label="Popular Movies" value={popularMovies?.results?.length || 0} color="oklch(0.68 0.24 264)" />
                  <StatCard icon={Tv} label="Popular TV" value={popularTv?.results?.length || 0} color="oklch(0.60 0.20 200)" />
                  <StatCard icon={Award} label="Top Rated" value={topRated?.results?.length || 0} color="oklch(0.75 0.18 85)" />
                </div>

                <ContentRow
                  title="Trending This Week"
                  icon={<Flame className="w-4 h-4 text-orange-400" />}
                  items={trendingItems}
                  onSelect={(item) => setSelectedItem({ id: item.id, type: (item.media_type || 'movie') as 'movie' | 'tv' })}
                />
                {popularMovies?.results && (
                  <ContentRow
                    title="Popular Movies"
                    icon={<Film className="w-4 h-4 text-indigo-400" />}
                    items={popularMovies.results}
                    onSelect={(item) => setSelectedItem({ id: item.id, type: 'movie' })}
                  />
                )}
                {popularTv?.results && (
                  <ContentRow
                    title="Popular TV Shows"
                    icon={<Tv className="w-4 h-4 text-cyan-400" />}
                    items={popularTv.results}
                    onSelect={(item) => setSelectedItem({ id: item.id, type: 'tv' })}
                  />
                )}
              </>
            )}
            {browseTab === 'movies' && (
              <ContentRow
                title="Popular Movies"
                icon={<Film className="w-4 h-4 text-indigo-400" />}
                items={popularMovies?.results || []}
                onSelect={(item) => setSelectedItem({ id: item.id, type: 'movie' })}
              />
            )}
            {browseTab === 'tv' && (
              <ContentRow
                title="Popular TV Shows"
                icon={<Tv className="w-4 h-4 text-cyan-400" />}
                items={popularTv?.results || []}
                onSelect={(item) => setSelectedItem({ id: item.id, type: 'tv' })}
              />
            )}
            {browseTab === 'top-rated' && (
              <ContentRow
                title="Top Rated of All Time"
                icon={<Award className="w-4 h-4 text-amber-400" />}
                items={topRated?.results || []}
                onSelect={(item) => setSelectedItem({ id: item.id, type: 'movie' })}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Hero Carousel (cinematic auto-rotating banner) ────────────────────────

function HeroCarousel({ items, onSelect }: { items: MediaItem[]; onSelect: (item: MediaItem) => void }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const SLIDE_DURATION = 6000 // 6 seconds per slide

  // Clamp index if items shrink (e.g. after a refetch returns fewer results)
  useEffect(() => {
    if (index > items.length - 1) setIndex(0)
  }, [items.length, index])

  // Auto-advance — StrictMode-safe via ref + cleanup
  useEffect(() => {
    if (paused || items.length <= 1) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % items.length)
    }, SLIDE_DURATION)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [paused, items.length])

  const goTo = (i: number) => {
    setIndex(((i % items.length) + items.length) % items.length)
  }

  // No items yet — show a shimmer placeholder
  if (!items.length) {
    return (
      <div className="relative h-[55vh] min-h-[360px] w-full overflow-hidden">
        <ShimmerLine className="absolute inset-0 !rounded-none" />
      </div>
    )
  }

  const current = items[index]
  const backdrop = tmdbBackdrop(current?.backdrop_path, 'w1280') || tmdbImage(current?.poster_path, 'w780')
  const title = current?.title || current?.name || 'Unknown'

  return (
    <div
      className="relative h-[60vh] min-h-[380px] sm:h-[65vh] sm:min-h-[420px] md:h-[70vh] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Touch handlers — pause on touch, resume after 3s of no touch
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => {
        // Resume after a brief delay so taps don't immediately restart the timer
        setTimeout(() => setPaused(false), 3000)
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          <img
            src={backdrop || ''}
            alt=""
            className="w-full h-full object-cover"
            style={{ animation: 'ken-burns 30s ease-out infinite alternate' }}
          />
          <style>{`
            @keyframes ken-burns {
              0%   { transform: scale(1) translate(0, 0); }
              100% { transform: scale(1.12) translate(-1%, -2%); }
            }
          `}</style>
        </motion.div>
      </AnimatePresence>

      {/* Cinematic gradient layers */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-transparent" />

      {/* Meteors overlay for cinematic ambiance */}
      <Meteors count={8} className="opacity-40" />

      {/* Content */}
      <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8 md:p-10 lg:p-14">
        <div className="max-w-6xl mx-auto">
          <motion.div
            key={`content-${current.id}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            {/* PulseBeam LIVE indicator */}
            <div className="flex items-center gap-2 mb-3">
              <PulseBeam color="oklch(0.66 0.22 25)" />
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-orange-400">
                Now Trending
              </span>
              <span className="text-muted-foreground/50 hidden sm:inline">•</span>
              <span className="hidden sm:inline text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {current.media_type === 'tv' ? 'TV Series' : 'Film'}
              </span>
            </div>

            {/* Title with animated gradient — responsive sizes */}
            <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-black tracking-tight mb-3 sm:mb-4 line-clamp-2 max-w-3xl">
              <AnimatedGradientText
                className="drop-shadow-2xl"
                colors={['#ffffff', '#c7d2fe', '#f5d0fe', '#fed7aa', '#ffffff']}
                animationSpeed={8}
              >
                {title}
              </AnimatedGradientText>
            </h1>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-4 text-xs sm:text-sm">
              {current.vote_average > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-dark">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                  <span className="font-bold">{current.vote_average.toFixed(1)}</span>
                </div>
              )}
              {(current.release_date || current.first_air_date) && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" />
                  {(current.release_date || current.first_air_date)!.slice(0, 4)}
                </div>
              )}
              <div className="hidden sm:flex items-center gap-1.5 text-muted-foreground">
                <Info className="w-3.5 h-3.5" />
                <span className="capitalize">{current.media_type === 'tv' ? 'Series' : 'Movie'}</span>
              </div>
            </div>

            <p className="text-sm sm:text-base text-foreground/70 line-clamp-2 sm:line-clamp-3 mb-4 sm:mb-6 max-w-xl sm:max-w-2xl leading-relaxed">
              {current.overview}
            </p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 sm:gap-3">
              <StarBorder color="oklch(0.68 0.24 264)" className="rounded-xl">
                <button
                  onClick={() => onSelect(current)}
                  className="flex items-center gap-2 px-5 sm:px-7 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-bold text-xs sm:text-sm hover:from-primary/90 hover:to-primary/70 transition-colors"
                >
                  <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                  <span className="hidden sm:inline">Watch Now</span>
                  <span className="sm:hidden">Play</span>
                </button>
              </StarBorder>
              <button
                onClick={() => onSelect(current)}
                className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl glass-dark text-xs sm:text-sm font-semibold hover:scale-105 transition-transform"
              >
                <Info className="w-4 h-4" />
                <span className="hidden sm:inline">Details</span>
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Carousel indicators with progress bar */}
      <div className="absolute bottom-3 sm:bottom-4 right-4 sm:right-6 md:right-10 flex gap-1.5 z-20">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={cn(
              'h-1.5 rounded-full transition-all duration-500',
              i === index ? 'w-6 sm:w-8 bg-primary shadow-glow' : 'w-1.5 bg-white/30 hover:bg-white/50'
            )}
            aria-label={`Slide ${i + 1}`}
          />
        ))}
      </div>

      {/* Progress bar at the very bottom — visual cue that the slide is auto-advancing */}
      {!paused && items.length > 1 && (
        <div className="absolute bottom-0 inset-x-0 h-0.5 bg-white/5 z-20 overflow-hidden">
          <motion.div
            key={`progress-${index}`}
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: SLIDE_DURATION / 1000, ease: 'linear' }}
            className="h-full bg-primary/60"
          />
        </div>
      )}
    </div>
  )
}

// ─── Stat Card (animated counters) ──────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Film
  label: string
  value: number
  color: string
}) {
  return (
    <SpotlightCard
      className="rounded-2xl border-white/10 bg-card/40"
      spotlightColor={`${color.replace('oklch(', 'oklch(').replace(')', ' / 0.2)')}`}
    >
      <div className="p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
        <div
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${color.replace(')', ' / 0.15)')}`, boxShadow: `0 0 16px ${color.replace(')', ' / 0.4)')}` }}
        >
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color }} />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
          <div className="text-lg sm:text-xl font-black">
            <Counter value={value} duration={1.2} />
          </div>
        </div>
      </div>
    </SpotlightCard>
  )
}

// ─── Content Row (horizontal scroller) ──────────────────────────────────────

function ContentRow({
  title,
  icon,
  items,
  onSelect,
}: {
  title: string
  icon?: React.ReactNode
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir === 'left' ? -500 : 500, behavior: 'smooth' })
  }

  if (!items.length) return null

  return (
    <div className="mb-10 group/row">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          {icon}
          <ShinyText shimmerDuration={5} className="text-base font-bold">{title}</ShinyText>
          <span className="text-xs font-normal text-muted-foreground ml-1">{items.length}</span>
        </h2>
        <div className="flex gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity duration-300">
          <button
            onClick={() => scroll('left')}
            className="p-2 rounded-lg glass-dark border-white/10 hover:scale-110 transition-transform"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-2 rounded-lg glass-dark border-white/10 hover:scale-110 transition-transform"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-4 cinema-row-scroll"
        style={{ scrollbarWidth: 'thin' }}
      >
        {items.map((item, idx) => (
          <motion.div
            key={`${item.id}-${item.media_type || 'movie'}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: Math.min(idx * 0.03, 0.3) }}
          >
            <MediaCard item={item} onClick={() => onSelect(item)} compact />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─── Media Card (cinematic poster with tilt + spotlight) ────────────────────

function MediaCard({ item, onClick, compact }: { item: MediaItem; onClick: () => void; compact?: boolean }) {
  const poster = tmdbImage(item.poster_path, 'w342')
  const title = item.title || item.name || 'Unknown'
  const date = item.release_date || item.first_air_date
  const [imgLoaded, setImgLoaded] = useState(false)

  const cardWidth = compact ? 'w-36 md:w-40' : 'w-full'

  return (
    <button onClick={onClick} className={cn('shrink-0 text-left group/card', cardWidth)}>
      <TiltedCard
        rotateAmplitude={10}
        scaleOnHover={1.06}
        spotlightColor="rgba(99, 102, 241, 0.35)"
        className="rounded-2xl"
      >
        <div className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-card border border-white/10 shadow-lg">
          {!imgLoaded && <ShimmerLine className="absolute inset-0 !rounded-2xl" />}
          {poster ? (
            <img
              src={poster}
              alt=""
              className={cn(
                'w-full h-full object-cover transition-opacity duration-500',
                imgLoaded ? 'opacity-100' : 'opacity-0'
              )}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
              <Film className="w-10 h-10 text-muted-foreground" />
            </div>
          )}

          {/* Top gradient + rating badge */}
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          {item.vote_average > 0 && (
            <div className="absolute top-2 right-2 px-2 py-1 rounded-lg glass-dark text-[10px] font-bold flex items-center gap-1">
              <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
              {item.vote_average.toFixed(1)}
            </div>
          )}

          {/* Hover overlay with Play button */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              whileHover={{ y: 0, opacity: 1 }}
              className="flex items-center gap-2"
            >
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shadow-glow">
                <Play className="w-4 h-4 text-primary-foreground fill-current" />
              </div>
              <span className="text-xs font-semibold">Watch</span>
            </motion.div>
          </div>

          {/* Top-left type chip */}
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md glass-dark text-[9px] font-bold uppercase tracking-wider">
            {item.media_type === 'tv' ? 'TV' : 'Film'}
          </div>
        </div>
      </TiltedCard>

      <div className="pt-2 px-0.5">
        <div className="text-xs font-semibold truncate group-hover/card:text-primary transition-colors">{title}</div>
        {date && (
          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
            <Calendar className="w-2.5 h-2.5" />
            {date.slice(0, 4)}
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Cinema Skeleton Loader ─────────────────────────────────────────────────

function CinemaSkeletonLoader() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <ShimmerLine key={i} className="h-16 !rounded-2xl" />
        ))}
      </div>
      {[1, 2, 3].map((row) => (
        <div key={row}>
          <ShimmerLine className="h-5 w-48 mb-4" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <ShimmerLine key={i} className="w-36 md:w-40 aspect-[2/3] shrink-0 !rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Detail View (immersive cinematic page) ─────────────────────────────────

function DetailView({ item, onBack }: { item: { id: number; type: 'movie' | 'tv' }; onBack: () => void }) {
  // Re-mount trick: when this changes, we reset all internal state (season/episode/etc)
  const [localItem, setLocalItem] = useState(item)
  const [playing, setPlaying] = useState(false)
  const [aggregator, setAggregator] = useState<Aggregator | null>(null)
  const [selectedSeason, setSelectedSeason] = useState(1)
  const [selectedEpisode, setSelectedEpisode] = useState(1)

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['cinema-detail', localItem.type, localItem.id],
    queryFn: async () => {
      const endpoint = localItem.type === 'movie' ? `/api/cinema/movie/${localItem.id}` : `/api/cinema/tv/${localItem.id}`
      const res = await fetch(endpoint)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const detail: DetailData | undefined = detailData?.[localItem.type] || detailData?.movie || detailData?.tv
  const aggregators = getAggregatorsForType(localItem.type)

  const handlePlay = () => {
    setAggregator(aggregators[0])
    setPlaying(true)
  }

  // Navigate to a recommendation (replaces the current detail view)
  const navigateTo = (newItem: { id: number; type: 'movie' | 'tv' }) => {
    setLocalItem(newItem)
    setPlaying(false)
    setAggregator(null)
    setSelectedSeason(1)
    setSelectedEpisode(1)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (playing && aggregator && detail) {
    return (
      <PlayerView
        aggregator={aggregator}
        aggregators={aggregators}
        onAggregatorChange={setAggregator}
        type={localItem.type}
        tmdbId={localItem.id}
        imdbId={detail.imdb_id}
        title={detail.title || detail.name || 'Unknown'}
        selectedSeason={selectedSeason}
        selectedEpisode={selectedEpisode}
        seasons={detail.seasons}
        onSeasonChange={(s) => { setSelectedSeason(s); setSelectedEpisode(1) }}
        onEpisodeChange={setSelectedEpisode}
        onBack={() => setPlaying(false)}
      />
    )
  }

  if (isLoading || !detail) {
    return (
      <div className="h-full gradient-cinematic flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading cinematic experience...</p>
        </div>
      </div>
    )
  }

  const backdrop = tmdbBackdrop(detail.backdrop_path, 'w1280') || tmdbImage(detail.poster_path, 'w780')
  const poster = tmdbImage(detail.poster_path, 'w342')
  const title = detail.title || detail.name || 'Unknown'
  const date = detail.release_date || detail.first_air_date
  const cast = detail.credits?.cast?.slice(0, 8) || []
  const runtime = detail.runtime
  const seasons = detail.seasons?.filter((s) => s.season_number > 0) || []

  return (
    <div className="h-full overflow-y-auto gradient-cinematic cinema-scroll">
      {/* ─── Cinematic Backdrop Hero ─────────────────────────────────────── */}
      <div className="relative h-[40vh] min-h-[280px] sm:h-[50vh] sm:min-h-[360px] md:h-[55vh] md:min-h-[400px]">
        <motion.div
          initial={{ scale: 1.05, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1 }}
          className="absolute inset-0"
        >
          <img
            src={backdrop || ''}
            alt=""
            className="w-full h-full object-cover"
            style={{ animation: 'ken-burns-slow 25s ease-in-out infinite alternate' }}
          />
          <style>{`
            @keyframes ken-burns-slow {
              0%   { transform: scale(1) translate(0, 0); }
              100% { transform: scale(1.08) translate(-1%, -1%); }
            }
          `}</style>
        </motion.div>

        {/* Multi-layer cinematic gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/30" />

        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-3 left-3 sm:top-4 sm:left-4 md:top-6 md:left-6 p-2 sm:p-2.5 rounded-xl glass-dark border-white/10 z-20 hover:scale-105 transition-transform"
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Bookmark / Like buttons */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 md:top-6 md:right-6 flex gap-2 z-20">
          <button className="p-2 sm:p-2.5 rounded-xl glass-dark border-white/10 hover:scale-105 transition-transform" aria-label="Add to watchlist">
            <Bookmark className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button className="p-2 sm:p-2.5 rounded-xl glass-dark border-white/10 hover:scale-105 transition-transform" aria-label="Like">
            <Heart className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </div>

      {/* ─── Detail Body ─────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 -mt-24 sm:-mt-28 md:-mt-32 relative z-10 pb-12">
        <div className="flex flex-col md:flex-row gap-5 sm:gap-6 mb-6 sm:mb-8">
          {/* Poster with TiltedCard */}
          <div className="shrink-0 mx-auto md:mx-0 -mt-16 sm:-mt-20 md:-mt-24">
            <TiltedCard
              rotateAmplitude={8}
              scaleOnHover={1.04}
              spotlightColor="rgba(99, 102, 241, 0.3)"
              className="rounded-2xl"
            >
              <div className="w-28 sm:w-36 md:w-48 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                {poster ? (
                  <img src={poster} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-card flex items-center justify-center">
                    <Film className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground" />
                  </div>
                )}
              </div>
            </TiltedCard>
          </div>

          {/* Title block */}
          <div className="flex-1 min-w-0 pt-1 sm:pt-2 md:pt-6 text-center md:text-left">
            {detail.tagline && (
              <p className="text-xs italic text-muted-foreground mb-2">{detail.tagline}</p>
            )}
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-black tracking-tight mb-3 leading-tight">
              <AnimatedGradientText
                colors={['#ffffff', '#c7d2fe', '#f5d0fe', '#ffffff']}
                animationSpeed={7}
              >
                {title}
              </AnimatedGradientText>
            </h1>

            {/* Meta strip */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3 mb-4 text-xs">
              {detail.vote_average > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg glass-dark">
                  <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                  <span className="font-bold">{detail.vote_average.toFixed(1)}</span>
                  <span className="text-muted-foreground">/10</span>
                </div>
              )}
              {date && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" />
                  {date.slice(0, 4)}
                </div>
              )}
              {runtime && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  {Math.floor(runtime / 60) > 0 && `${Math.floor(runtime / 60)}h `}
                  {runtime % 60}m
                </div>
              )}
              {detail.number_of_seasons && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Tv className="w-3.5 h-3.5" />
                  {detail.number_of_seasons} season{detail.number_of_seasons !== 1 ? 's' : ''}
                </div>
              )}
              {detail.status && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <PulseBeam color="oklch(0.72 0.18 145)" />
                  <span className="font-medium">{detail.status}</span>
                </div>
              )}
            </div>

            {/* Genres */}
            {detail.genres && detail.genres.length > 0 && (
              <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-5">
                {detail.genres.map((g) => (
                  <span
                    key={g.id}
                    className="px-2.5 py-1 rounded-lg glass-dark text-[11px] font-medium border border-white/5"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* Play button with StarBorder — centered on mobile, left-aligned on desktop */}
            <div className="flex items-center justify-center md:justify-start gap-2 sm:gap-3 mb-2">
              <StarBorder color="oklch(0.68 0.24 264)" className="rounded-xl">
                <button
                  onClick={handlePlay}
                  className="flex items-center gap-2 px-5 sm:px-7 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-bold text-xs sm:text-sm hover:from-primary/90 hover:to-primary/70 transition-colors"
                >
                  <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                  <span>Play {localItem.type === 'tv' ? 'S1:E1' : 'Now'}</span>
                </button>
              </StarBorder>
              <button
                onClick={handlePlay}
                className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl glass-dark text-xs sm:text-sm font-semibold hover:scale-105 transition-transform"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Trailer</span>
              </button>
            </div>
          </div>
        </div>

        {/* ─── Overview (GlassSurface panel) ─────────────────────────────── */}
        <GlassSurface blur={20} opacity={0.04} className="rounded-2xl p-5 mb-6">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">
            <Info className="w-3.5 h-3.5" /> Synopsis
          </h3>
          <p className="text-sm text-foreground/80 leading-relaxed">{detail.overview || 'No synopsis available.'}</p>
        </GlassSurface>

        {/* ─── TV Episode Selector ───────────────────────────────────────── */}
        {localItem.type === 'tv' && seasons.length > 0 && (
          <GlassSurface blur={20} opacity={0.04} className="rounded-2xl p-5 mb-6">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">
              <Tv className="w-3.5 h-3.5" /> Episode Selector
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <select
                value={selectedSeason}
                onChange={(e) => { setSelectedSeason(parseInt(e.target.value, 10)); setSelectedEpisode(1) }}
                className="bg-card border border-white/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:border-primary/50 transition-colors"
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.season_number}>
                    Season {s.season_number} ({s.episode_count} eps)
                  </option>
                ))}
              </select>
              <select
                value={selectedEpisode}
                onChange={(e) => setSelectedEpisode(parseInt(e.target.value, 10))}
                className="bg-card border border-white/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:border-primary/50 transition-colors"
              >
                {Array.from({ length: seasons.find((s) => s.season_number === selectedSeason)?.episode_count || 10 }, (_, i) => (
                  <option key={i} value={i + 1}>Episode {i + 1}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handlePlay}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/15 text-primary text-sm font-semibold hover:bg-primary/25 transition-colors"
            >
              <Play className="w-4 h-4 fill-current" />
              Play S{selectedSeason}:E{selectedEpisode}
            </button>
          </GlassSurface>
        )}

        {/* ─── Cast ──────────────────────────────────────────────────────── */}
        {cast.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">Cast</h3>
            <div className="flex gap-4 overflow-x-auto pb-2 cinema-row-scroll">
              {cast.map((person) => (
                <div key={person.id} className="shrink-0 w-24 text-center group/person">
                  <div className="w-24 h-24 rounded-full overflow-hidden mb-2 ring-2 ring-white/10 group-hover/person:ring-primary/40 transition-all">
                    {person.profile_path ? (
                      <img src={tmdbImage(person.profile_path, 'w185') || ''} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center">
                        <span className="text-2xl font-black text-muted-foreground">{person.name.charAt(0)}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-semibold truncate">{person.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{person.character}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Recommendations ───────────────────────────────────────────── */}
        {detail.recommendations?.results && detail.recommendations.results.length > 0 && (
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> More Like This
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {detail.recommendations!.results.slice(0, 12).map((rec) => (
                <MediaCard
                  key={rec.id}
                  item={rec}
                  onClick={() => navigateTo({ id: rec.id, type: (rec.media_type || localItem.type) as 'movie' | 'tv' })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Player View (cinematic immersive player) ───────────────────────────────

function PlayerView({
  aggregator,
  aggregators,
  onAggregatorChange,
  type,
  tmdbId,
  imdbId,
  title,
  selectedSeason,
  selectedEpisode,
  seasons,
  onSeasonChange,
  onEpisodeChange,
  onBack,
}: {
  aggregator: Aggregator
  aggregators: Aggregator[]
  onAggregatorChange: (a: Aggregator) => void
  type: 'movie' | 'tv'
  tmdbId: number
  imdbId?: string
  title: string
  selectedSeason: number
  selectedEpisode: number
  seasons?: { id: number; name: string; season_number: number; episode_count: number; poster_path: string }[]
  onSeasonChange: (s: number) => void
  onEpisodeChange: (e: number) => void
  onBack: () => void
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const validSeasons = seasons?.filter((s) => s.season_number > 0) || []

  const embedUrl = type === 'movie'
    ? aggregator.movieUrl(tmdbId, imdbId)
    : aggregator.tvUrl(tmdbId, selectedSeason, selectedEpisode)

  // Reset loading state when URL changes
  useEffect(() => {
    setIframeLoaded(false)
  }, [embedUrl])

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header — compact on mobile */}
      <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 md:p-4 bg-gradient-to-b from-black/90 to-black/60 border-b border-white/5">
        <button
          onClick={onBack}
          className="p-2 sm:p-2.5 rounded-xl glass-dark border-white/10 hover:scale-105 transition-transform shrink-0"
        >
          <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <PulseBeam color="oklch(0.66 0.22 25)" />
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-orange-400">Now Playing</span>
          </div>
          <div className="text-xs sm:text-sm font-semibold truncate mt-0.5">
            {title}
            {type === 'tv' && (
              <span className="text-muted-foreground font-normal ml-1.5 sm:ml-2">S{selectedSeason} • E{selectedEpisode}</span>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground hidden md:flex items-center gap-2 shrink-0">
          <Zap className="w-3.5 h-3.5 text-primary" />
          {aggregator.quality}
        </div>
      </div>

      {/* Server selector — horizontally scrollable on mobile */}
      <div className="flex items-center gap-1.5 sm:gap-2 p-2.5 sm:p-3 md:p-4 bg-gradient-to-b from-black/60 to-transparent border-b border-white/5 overflow-x-auto cinema-row-scroll">
        <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 mr-0.5 sm:mr-1">
          Server
        </span>
        {aggregators.map((agg, i) => (
          <button
            key={agg.id}
            onClick={() => onAggregatorChange(agg)}
            className={cn(
              'flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-semibold shrink-0 transition-all',
              aggregator.id === agg.id
                ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-glow'
                : 'glass-dark text-muted-foreground hover:text-foreground hover:scale-105'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', aggregator.id === agg.id ? 'bg-white animate-pulse' : 'bg-muted-foreground')} />
            {agg.name}
            <span className="text-[9px] opacity-70 hidden md:inline">• {i === 0 ? 'Primary' : 'Backup'}</span>
          </button>
        ))}
      </div>

      {/* TV Episode selector (when playing) */}
      {type === 'tv' && validSeasons.length > 0 && (
        <div className="flex gap-2 p-2.5 sm:p-3 md:p-4 bg-black/40 border-b border-white/5 overflow-x-auto cinema-row-scroll">
          <select
            value={selectedSeason}
            onChange={(e) => { onSeasonChange(parseInt(e.target.value, 10)); onEpisodeChange(1) }}
            className="bg-card border border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium shrink-0"
          >
            {validSeasons.map((s) => (
              <option key={s.id} value={s.season_number}>Season {s.season_number}</option>
            ))}
          </select>
          <select
            value={selectedEpisode}
            onChange={(e) => onEpisodeChange(parseInt(e.target.value, 10))}
            className="bg-card border border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium shrink-0"
          >
            {Array.from({ length: validSeasons.find((s) => s.season_number === selectedSeason)?.episode_count || 10 }, (_, i) => (
              <option key={i} value={i + 1}>Episode {i + 1}</option>
            ))}
          </select>
        </div>
      )}

      {/* Player area */}
      <div className="flex-1 relative bg-black">
        {/* Loading overlay */}
        <AnimatePresence>
          {!iframeLoaded && (
            <motion.div
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black"
            >
              <div className="relative w-16 h-16 mb-4">
                <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                <div
                  className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin"
                  style={{ animationDuration: '0.8s' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play className="w-6 h-6 text-primary fill-primary" />
                </div>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-1">
                Loading {aggregator.name}
              </div>
              <div className="text-xs text-muted-foreground/60">Connecting to {aggregator.quality} stream...</div>
              <ShimmerLine className="w-32 h-1 mt-4" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* The actual iframe — NO sandbox attribute (aggregators refuse to load sandboxed) */}
        <iframe
          key={embedUrl}
          src={embedUrl}
          className="absolute inset-0 w-full h-full"
          frameBorder="0"
          allowFullScreen
          allow={IFRAME_ALLOW}
          referrerPolicy="no-referrer"
          onLoad={() => setIframeLoaded(true)}
        />

        {/* Bottom gradient (cinematic letterbox feel) */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />
      </div>

      {/* Footer note */}
      <div className="px-4 py-2 bg-black/80 border-t border-white/5 text-[10px] text-muted-foreground/60 text-center">
        If the video doesn't start within 30s, try switching to {aggregators.find((a) => a.id !== aggregator.id)?.name || 'another server'} above.
      </div>
    </div>
  )
}
