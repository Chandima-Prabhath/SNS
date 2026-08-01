import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware — rate limiting + security headers.
 *
 * Runs on ALL requests (matcher: '/:path*').
 * - API routes: rate limiting + security headers
 * - Non-API routes: security headers only
 */

interface Bucket {
  tokens: number
  lastRefill: number
}

const RATE_LIMITS: Record<string, { maxTokens: number; refillRate: number }> = {
  auth: { maxTokens: 5, refillRate: 5 / 60 },
  ai: { maxTokens: 5, refillRate: 5 / 60 },
  upload: { maxTokens: 10, refillRate: 10 / 60 },
  default: { maxTokens: 100, refillRate: 100 / 60 },
}

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

/** Add security headers to any response */
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  return response
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  // ── Security headers on ALL routes ──────────────────────────────
  if (!isApi) {
    // Non-API route — just add security headers, no rate limiting
    return addSecurityHeaders(NextResponse.next())
  }

  // ── Rate limiting on API routes ─────────────────────────────────
  // Skip rate limiting for non-mutating GET requests on general API
  if (request.method === 'GET' && getTier(pathname) === 'default') {
    return addSecurityHeaders(NextResponse.next())
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

  const elapsed = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(limit.maxTokens, bucket.tokens + elapsed * limit.refillRate)
  bucket.lastRefill = now

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil(1 / limit.refillRate)
    return addSecurityHeaders(NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit.maxTokens),
          'X-RateLimit-Remaining': '0',
        },
      }
    ))
  }

  bucket.tokens -= 1

  const response = NextResponse.next()
  response.headers.set('X-RateLimit-Limit', String(limit.maxTokens))
  response.headers.set('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)))
  return addSecurityHeaders(response)
}

export const config = {
  matcher: '/:path*',
}
