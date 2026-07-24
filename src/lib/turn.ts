/**
 * ICE server configuration with swappable TURN providers.
 *
 * Provider selection (in priority order):
 *   1. Cloudflare TURN  — if CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_KEY_SECRET are set
 *   2. Metered OpenRelay — always included as a sensible default (free, public)
 *   3. Custom coturn     — if CUSTOM_TURN_URL + CUSTOM_TURN_USER + CUSTOM_TURN_CRED are set
 *   4. Google STUN       — always included as a fallback
 *
 * To swap providers, just edit .env — no code changes needed.
 *
 * Cloudflare credentials are time-limited (HMAC-SHA1 signed per call, server-side).
 * Metered OpenRelay currently uses shared public credentials (openrelayproject).
 * Custom coturn uses plain long-term credentials.
 */
import crypto from 'crypto'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

const TURN_TTL_SECONDS = 3600 // 1 hour (Cloudflare)

// ─────────────────────────────────────────────────────────────────────────────
// Google STUN — always included, free, no auth
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_STUN: IceServer = {
  urls: process.env.WEBRTC_STUN_URL || 'stun:stun.l.google.com:19302',
}

// ─────────────────────────────────────────────────────────────────────────────
// Metered OpenRelay — free public TURN (20 GB/month free tier)
// Docs: https://www.metered.ca/tools/openrelay/
// ─────────────────────────────────────────────────────────────────────────────
const METERED_STUN: IceServer = {
  urls: 'stun:openrelay.metered.ca:80',
}

const METERED_TURN_UDP: IceServer = {
  urls: 'turn:openrelay.metered.ca:80',
  username: 'openrelayproject',
  credential: 'openrelayproject',
}

const METERED_TURN_TCP: IceServer = {
  urls: 'turn:openrelay.metered.ca:443',
  username: 'openrelayproject',
  credential: 'openrelayproject',
}

const METERED_TURN_TLS: IceServer = {
  urls: 'turns:openrelay.metered.ca:443',
  username: 'openrelayproject',
  credential: 'openrelayproject',
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare TURN — optional, requires CLOUDFLARE_TURN_KEY_ID + SECRET in .env
// Docs: https://developers.cloudflare.com/calls/turn/
// ─────────────────────────────────────────────────────────────────────────────
function getCloudflareTurnServers(): IceServer[] {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID
  const keySecret = process.env.CLOUDFLARE_TURN_KEY_SECRET
  const turnUrl = process.env.CLOUDFLARE_TURN_URL || 'turn:turn.cloudflare.com:3478?transport=udp'
  if (!keyId || !keySecret) return []

  // Generate time-limited REST API credentials (RFC 5389 long-term creds)
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS
  const username = `${expiry}`
  const credential = crypto
    .createHmac('sha1', keySecret)
    .update(username)
    .digest('base64')

  return [
    {
      urls: turnUrl,
      username: `${keyId}:${username}`,
      credential,
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom coturn — optional, for self-hosted TURN
// Set CUSTOM_TURN_URL, CUSTOM_TURN_USER, CUSTOM_TURN_CRED in .env
// ─────────────────────────────────────────────────────────────────────────────
function getCustomTurnServers(): IceServer[] {
  const url = process.env.CUSTOM_TURN_URL
  const user = process.env.CUSTOM_TURN_USER
  const cred = process.env.CUSTOM_TURN_CRED
  if (!url || !user || !cred) return []
  return [{ urls: url, username: user, credential: cred }]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export function getIceServers(): IceServer[] {
  const servers: IceServer[] = [GOOGLE_STUN, METERED_STUN]

  // Metered TURN (default, free)
  servers.push(METERED_TURN_UDP, METERED_TURN_TCP, METERED_TURN_TLS)

  // Cloudflare TURN (optional, signed per-call)
  servers.push(...getCloudflareTurnServers())

  // Custom coturn (optional)
  servers.push(...getCustomTurnServers())

  return servers
}

export function getTurnProviderInfo() {
  return {
    stun: process.env.WEBRTC_STUN_URL || 'stun:stun.l.google.com:19302',
    providers: [
      { name: 'google-stun', enabled: true, type: 'stun' },
      { name: 'metered-openrelay', enabled: true, type: 'turn', note: 'free, 20GB/month' },
      { name: 'cloudflare-turn', enabled: isCloudflareTurnEnabled(), type: 'turn' },
      { name: 'custom-coturn', enabled: isCustomTurnEnabled(), type: 'turn' },
    ],
    anyTurnEnabled: true, // Metered is always on
  }
}

export function isCloudflareTurnEnabled(): boolean {
  return !!(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_KEY_SECRET)
}

export function isCustomTurnEnabled(): boolean {
  return !!(process.env.CUSTOM_TURN_URL && process.env.CUSTOM_TURN_USER && process.env.CUSTOM_TURN_CRED)
}
