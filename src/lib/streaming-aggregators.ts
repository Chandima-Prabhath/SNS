/**
 * Streaming aggregator configuration.
 *
 * Each aggregator provides embed URLs for movies and TV shows using
 * TMDB IDs. We support multiple aggregators so users can switch servers
 * if one is down, slow, or doesn't have the content.
 *
 * Common pitfalls addressed:
 * 1. Aggregators go down → multiple fallbacks
 * 2. Some have pop-up ads → we sandbox the iframe with strict sandboxing
 * 3. Some don't support certain content → user picks another server
 * 4. URL formats differ → each aggregator has its own URL builder
 */

export interface Aggregator {
  id: string
  name: string
  /** Build the embed URL for a movie */
  movieUrl: (tmdbId: number, imdbId?: string) => string
  /** Build the embed URL for a TV show episode */
  tvUrl: (tmdbId: number, season: number, episode: number) => string
  /** Whether this aggregator supports movies */
  supportsMovies: boolean
  /** Whether this aggregator supports TV shows */
  supportsTv: boolean
  /** Quality label for UI */
  quality: string
}

export const AGGREGATORS: Aggregator[] = [
  {
    id: 'vidlink',
    name: 'VidLink',
    movieUrl: (tmdbId) => `https://vidlink.pro/movie/${tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://vidlink.pro/tv/${tmdbId}/${s}/${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
  },
  {
    id: 'vidsrc',
    name: 'VidSrc',
    movieUrl: (tmdbId, imdbId) => `https://vidsrc.to/embed/movie/${imdbId || tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
  },
  {
    id: 'vidsrc-pro',
    name: 'VidSrc Pro',
    movieUrl: (tmdbId, imdbId) => `https://vidsrc.pro/embed/movie/${imdbId || tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://vidsrc.pro/embed/tv/${tmdbId}/${s}/${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: '4K',
  },
  {
    id: 'superembed',
    name: 'SuperEmbed',
    movieUrl: (tmdbId) => `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`,
    tvUrl: (tmdbId, s, e) => `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
  },
  {
    id: '2embed',
    name: '2Embed',
    movieUrl: (tmdbId) => `https://www.2embed.cc/embed/${tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
  },
  {
    id: 'smashy',
    name: 'SmashyStream',
    movieUrl: (tmdbId) => `https://embed.su/embed/movie/${tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://embed.su/embed/tv/${tmdbId}/${s}/${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
  },
]

/**
 * Get aggregators that support the given content type.
 */
export function getAggregatorsForType(type: 'movie' | 'tv'): Aggregator[] {
  return AGGREGATORS.filter((a) => type === 'movie' ? a.supportsMovies : a.supportsTv)
}
