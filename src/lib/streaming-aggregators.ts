/**
 * Streaming aggregator configuration.
 *
 * IMPORTANT (2026-07): Many aggregators that were popular in 2024 have either
 * shut down or broken. We keep ONLY providers that have been verified to work
 * reliably. Adding more "just in case" providers creates a worse UX (users click
 * through dead servers before finding one that works).
 *
 * VERIFIED WORKING (as of 2026-07):
 *   - VidSrc (vidsrc.to)     — HD, fast, multi-server inside player
 *   - 2Embed (2embed.cc)     — HD, reliable, no popups
 *
 * VERIFIED BROKEN — DO NOT RE-ADD:
 *   - vidlink.pro            — refuses to load inside sandboxed iframe
 *   - vidsrc.pro / embed.su  — server offline (DNS NXDOMAIN on embed.su)
 *   - smashystream          — same as above (uses embed.su backend)
 *   - superembed / multiembed.mov — page loads but video never plays
 *
 * If you want to add a new provider, verify it works inside an iframe with
 * `sandbox="allow-scripts allow-same-origin allow-presentation"` AND with no
 * sandbox attribute at all, then add it here.
 */

export interface Aggregator {
  id: string
  name: string
  /** Short tagline shown under the name */
  tagline: string
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
  /** Recommended order — lower = tried first */
  priority: number
}

export const AGGREGATORS: Aggregator[] = [
  {
    id: 'vidsrc',
    name: 'VidSrc',
    tagline: 'Primary • Multi-server',
    movieUrl: (tmdbId, imdbId) => `https://vidsrc.to/embed/movie/${imdbId || tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
    priority: 1,
  },
  {
    id: '2embed',
    name: '2Embed',
    tagline: 'Backup • Clean UI',
    movieUrl: (tmdbId) => `https://www.2embed.cc/embed/${tmdbId}`,
    tvUrl: (tmdbId, s, e) => `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`,
    supportsMovies: true,
    supportsTv: true,
    quality: 'HD',
    priority: 2,
  },
]

/**
 * Get aggregators that support the given content type, sorted by priority.
 */
export function getAggregatorsForType(type: 'movie' | 'tv'): Aggregator[] {
  return AGGREGATORS.filter((a) => type === 'movie' ? a.supportsMovies : a.supportsTv)
    .sort((a, b) => a.priority - b.priority)
}

/**
 * Recommended iframe attributes for embedding streaming aggregators.
 *
 * Most aggregators need:
 *   - allow-scripts        — to run their player JS
 *   - allow-same-origin    — to access their own cookies / localStorage
 *   - allow-presentation   — for fullscreen API
 *   - allow-forms          — some have search/login forms inside
 *   - allow-popups         — some open ads in new tabs (annoying but needed for them to function)
 *
 * We also force `allow-popups-to-escape-sandbox` so any popups the aggregator
 * spawns are not constrained by our sandbox.
 *
 * Note: referrerPolicy="no-referrer" prevents the aggregator from seeing our
 * host (some aggregators block known ad-blocker referrers).
 */
export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-forms allow-popups allow-popups-to-escape-sandbox'
