import { Innertube, type SessionOptions } from 'youtubei.js'

/**
 * Cached YouTube Music client.
 *
 * Creating a new Innertube instance on every request is slow (1-2 seconds
 * for the initial handshake). We cache the instance and reuse it across
 * requests. This makes search feel instant after the first request.
 */
let cachedYoutube: Innertube | null = null
let cachePromise: Promise<Innertube> | null = null

export async function getYoutube(): Promise<Innertube> {
  if (cachedYoutube) return cachedYoutube
  if (cachePromise) return cachePromise

  cachePromise = Innertube.create({
    // Use the Android client — it's less likely to trigger bot detection
    // than the default web client.
    client_type: 'ANDROID',
    retrieve_player: false,
  } as SessionOptions).then((yt) => {
    cachedYoutube = yt
    return yt
  }).catch((e) => {
    // If creation fails, clear the promise so the next request can retry
    cachePromise = null
    throw e
  })

  return cachePromise
}

/**
 * Check if an ID is a valid YouTube video ID.
 *
 * YouTube video IDs are exactly 11 characters, alphanumeric plus - and _.
 * They do NOT start with prefixes like:
 *   - MPRE (album browse ID)
 *   - UC (channel ID)
 *   - MPL (playlist browse ID)
 *   - VL (playlist ID prefix)
 *   - FEmusic (music browse ID)
 *
 * The getExplore() and search results can contain non-video items (albums,
 * artists, playlists) which we need to filter out before passing to yt-dlp.
 */
export function isValidVideoId(id: string | undefined | null): boolean {
  if (!id) return false
  // YouTube video IDs are exactly 11 chars: [a-zA-Z0-9_-]
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return false
  // Filter out known browse ID prefixes
  const upperPrefixes = ['MPRE', 'MPLA', 'UC', 'VL', 'RD', 'PL']
  for (const prefix of upperPrefixes) {
    if (id.startsWith(prefix)) return false
  }
  // Filter out IDs that start with 'FEmusic' (YouTube Music browse IDs)
  if (id.startsWith('FEmusic')) return false
  return true
}

/**
 * Deduplicate tracks by videoId, keeping the first occurrence.
 */
export function deduplicateTracks<T extends { videoId: string }>(tracks: T[]): T[] {
  const seen = new Set<string>()
  return tracks.filter((t) => {
    if (seen.has(t.videoId)) return false
    seen.add(t.videoId)
    return true
  })
}
