/**
 * Cloudflare TURN credential signer
 *
 * Cloudflare Calls TURN supports the TURN REST API (RFC 5389 long-term credentials).
 * Server generates time-limited credentials per call:
 *   username = "<expiryUnixTimestamp>"
 *   credential = HMAC-SHA1(secret, username) → base64
 *
 * When the user enables TURN (fills in CLOUDFLARE_TURN_KEY_ID and
 * CLOUDFLARE_TURN_KEY_SECRET in .env), this endpoint returns both STUN
 * and TURN servers. Otherwise only STUN is returned.
 *
 * Docs: https://developers.cloudflare.com/calls/turn/
 */
import crypto from 'crypto'

const TURN_TTL_SECONDS = 3600 // 1 hour

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export function getIceServers(): IceServer[] {
  const stunUrl = process.env.WEBRTC_STUN_URL || 'stun:stun.l.google.com:19302'
  const stun: IceServer = { urls: stunUrl }

  const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID
  const turnKeySecret = process.env.CLOUDFLARE_TURN_KEY_SECRET
  const turnUrl = process.env.CLOUDFLARE_TURN_URL || 'turn:turn.cloudflare.com:3478?transport=udp'

  if (!turnKeyId || !turnKeySecret) {
    // TURN not configured — STUN only
    return [stun]
  }

  // Generate REST API credentials
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS
  const username = `${expiry}`
  const credential = crypto
    .createHmac('sha1', turnKeySecret)
    .update(username)
    .digest('base64')

  return [
    stun,
    {
      urls: turnUrl,
      username: `${turnKeyId}:${username}`,
      credential,
    },
  ]
}

export function isTurnEnabled(): boolean {
  return !!(
    process.env.CLOUDFLARE_TURN_KEY_ID &&
    process.env.CLOUDFLARE_TURN_KEY_SECRET
  )
}
