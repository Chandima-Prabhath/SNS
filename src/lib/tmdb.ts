/**
 * TMDB API client with server-side in-memory cache.
 *
 * TMDB removed rate limiting in Dec 2019, but we still cache to:
 *   - Avoid redundant requests (same movie details fetched repeatedly)
 *   - Keep response times fast (cache hit = 0ms vs 200-500ms network)
 *   - Reduce bandwidth
 *
 * Cache TTL:
 *   - Trending/popular: 1 hour (changes slowly)
 *   - Movie/TV details: 24 hours (rarely change)
 *   - Search results: 10 minutes (user might re-search)
 *
 * The cache is a simple Map — no Redis needed. For a small friend-group
 * app this is sufficient. If the server restarts, the cache rebuilds
 * naturally from the first requests.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// In-memory cache: key → { data, expires }
const cache = new Map<string, { data: any; expires: number }>()

/** Fetch from TMDB with caching. */
async function tmdbFetch(path: string, ttlMs: number = 3600_000): Promise<any> {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) {
    throw new Error('TMDB_API_KEY not set in environment')
  }

  const cacheKey = path
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return cached.data
  }

  const url = `${TMDB_BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${apiKey}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    if (res.status === 429) {
      // Rate limited (shouldn't happen, but just in case) — return cached
      // data even if expired, or empty
      if (cached) return cached.data
      throw new Error('TMDB rate limited')
    }
    throw new Error(`TMDB error: ${res.status}`)
  }

  const data = await res.json()
  cache.set(cacheKey, { data, expires: Date.now() + ttlMs })
  return data
}

/** Clear all cached TMDB data (useful for debugging). */
export function clearTmdbCache() {
  cache.clear()
}

// ─── Image URL helpers ─────────────────────────────────────────────────────

export function tmdbImage(path: string | null | undefined, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string | null {
  if (!path) return null
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

export function tmdbBackdrop(path: string | null | undefined, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
  if (!path) return null
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

// ─── Trending ──────────────────────────────────────────────────────────────

export async function getTrending(mediaType: 'all' | 'movie' | 'tv' = 'all', window: 'day' | 'week' = 'week') {
  const data = await tmdbFetch(`/trending/${mediaType}/${window}`, 3600_000) // 1 hour
  return data.results || []
}

// ─── Popular / Top Rated ───────────────────────────────────────────────────

export async function getPopular(type: 'movie' | 'tv', page: number = 1) {
  const data = await tmdbFetch(`/${type}/popular?page=${page}`, 3600_000)
  return data.results || []
}

export async function getTopRated(type: 'movie' | 'tv', page: number = 1) {
  const data = await tmdbFetch(`/${type}/top_rated?page=${page}`, 3600_000)
  return data.results || []
}

export async function getNowPlaying() {
  const data = await tmdbFetch(`/movie/now_playing`, 3600_000)
  return data.results || []
}

export async function getAiringToday() {
  const data = await tmdbFetch(`/tv/airing_today`, 3600_000)
  return data.results || []
}

// ─── Search ────────────────────────────────────────────────────────────────

export async function searchMulti(query: string, page: number = 1) {
  const data = await tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}&page=${page}&include_adult=false`, 600_000) // 10 min
  return data.results || []
}

export async function searchMovies(query: string, page: number = 1) {
  const data = await tmdbFetch(`/search/movie?query=${encodeURIComponent(query)}&page=${page}&include_adult=false`, 600_000)
  return data.results || []
}

export async function searchTv(query: string, page: number = 1) {
  const data = await tmdbFetch(`/search/tv?query=${encodeURIComponent(query)}&page=${page}&include_adult=false`, 600_000)
  return data.results || []
}

// ─── Details ───────────────────────────────────────────────────────────────

export async function getMovieDetails(id: number) {
  return tmdbFetch(`/movie/${id}?append_to_response=credits,videos,similar,recommendations,images`, 86400_000) // 24h
}

export async function getTvDetails(id: number) {
  return tmdbFetch(`/tv/${id}?append_to_response=credits,videos,similar,recommendations,images`, 86400_000) // 24h
}

export async function getTvSeason(tvId: number, seasonNumber: number) {
  return tmdbFetch(`/tv/${tvId}/season/${seasonNumber}`, 86400_000) // 24h
}

// ─── Genres ────────────────────────────────────────────────────────────────

export async function getGenres(type: 'movie' | 'tv') {
  const data = await tmdbFetch(`/genre/${type}/list`, 86400_000) // 24h
  return data.genres || []
}

export async function discoverByGenre(type: 'movie' | 'tv', genreId: number, page: number = 1) {
  const data = await tmdbFetch(`/discover/${type}?with_genres=${genreId}&sort_by=popularity.desc&page=${page}`, 3600_000)
  return data.results || []
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TmdbMovie {
  id: number
  title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string | null
  vote_average: number
  vote_count: number
  genre_ids?: number[]
  genres?: { id: number; name: string }[]
  runtime?: number
  credits?: { cast: any[]; crew: any[] }
  videos?: { results: any[] }
  similar?: { results: any[] }
  recommendations?: { results: any[] }
  imdb_id?: string
}

export interface TmdbTv {
  id: number
  name: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  first_air_date: string | null
  vote_average: number
  vote_count: number
  genre_ids?: number[]
  genres?: { id: number; name: string }[]
  number_of_seasons?: number
  number_of_episodes?: number
  seasons?: any[]
  credits?: { cast: any[]; crew: any[] }
  videos?: { results: any[] }
  similar?: { results: any[] }
  recommendations?: { results: any[] }
  episodes?: any[]
}

export interface TmdbSeason {
  id: number
  name: string
  overview: string
  poster_path: string | null
  season_number: number
  episodes: {
    id: number
    name: string
    overview: string
    still_path: string | null
    episode_number: number
    runtime: number | null
    air_date: string | null
    vote_average: number
  }[]
}
