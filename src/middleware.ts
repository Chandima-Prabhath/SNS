import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Rate limiting middleware — in-memory token bucket per IP+path tier.
 *
 * Tiers:
 *   - auth:    5 req/min  (login, register — bcrypt is CPU-heavy)
 *   - ai:      5 req/min  (ASR, TTS — each spawns ffmpeg/Python processes)
 *   - upload:  10 req/min (file uploads — disk I/O)
 *   - default: 100 req/min (general API)
 *
 * On a 2vCPU/1GB VM, these limits prevent OOM and CPU exhaustion.
 * The in-memory map is fine for single-instance deploys. If the app ever
 * scales to multiple instances, switch to Redis-backed rate limiting.
 */

interface Bucket {
  tokens: number
  lastRefill: number
}

const RATE_LIMITS: Record<string, { maxTokens: number; refillRate: number }> = {
  auth: { maxTokens: 5, refillRate: 5 / 60 },     // 5 per minute
  ai: { maxTokens: 5, refillRate: 5 / 60 },       // 5 per minute
  upload: { maxTokens: 10, refillRate: 10 / 60 },  // 10 per minute
  default: { maxTokens: 100, refillRate: 100 / 60 }, // 100 per minute
}

// Use globalThis so the map survives hot-reloads in dev mode
const globalForRateLimit = globalThis as unknown as { __adoo_rateLimit?: Map<string, Bucket> }
const buckets: Map<string, Bucket> = globalForRateLimit.__adoo_rateLimit || new Map()
globalForRateLimit.__adoo_rateLimit = buckets

function getTier(pathname: string): keyof typeof RATE_LIMITS {
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/api/seed')) return 'auth'
  if (pathname.startsWith('/api/asr') || pathname.startsWith('/api/tts')) return 'ai'
  if (pathname.startsWith('/api/upload')) return 'upload'
  return 'default'
}

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = request.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only rate-limit API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Skip rate limiting for non-mutating GET requests on general API
  // (reading channels/messages is frequent and cheap)
  if (request.method === 'GET' && getTier(pathname) === 'default') {
    return NextResponse.next()
  }

  const tier = getTier(pathname)
  const limit = RATE_LIMITS[tier]
  const ip = getClientIP(request)
  const key = `${ip}:${tier}`

  const now = Date.now()
  let bucket = buckets.get(key)

  if (!bucket) {
    bucket = { tokens: limit.maxTokens, lastRefill: now }
    buckets.set(key, bucket)
  }

  // Refill tokens based on time elapsed
  const elapsed = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(limit.maxTokens, bucket.tokens + elapsed * limit.refillRate)
  bucket.lastRefill = now

  if (bucket.tokens < 1) {
    // Rate limited — return 429
    const retryAfter = Math.ceil(1 / limit.refillRate)
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit.maxTokens),
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  // Consume a token
  bucket.tokens -= 1

  const response = NextResponse.next()
  response.headers.set('X-RateLimit-Limit', String(limit.maxTokens))
  response.headers.set('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)))
  return response
}

export const config = {
  matcher: '/api/:path*',
}
