import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sharp from 'sharp'
import { readFile, mkdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import crypto from 'crypto'

/**
 * GET /api/img?src=/uploads/xxx.png&w=400&q=60
 *
 * Server-side image optimization using sharp with ON-DISK CACHING.
 *
 * The first request for a given (src, w, q) combination runs sharp and
 * saves the result to public/cache/img/<hash>.webp. Subsequent requests
 * for the same combination stream the cached file directly — no sharp
 * processing needed.
 *
 * Cache key: sha256(src + w + q) — deterministic, collision-free.
 * Cache format: WebP (best compression for photos, supported by all
 * modern browsers).
 *
 * Used for progressive loading: fetch a small version first (w=40, q=30),
 * then upgrade to a larger version.
 */

const CACHE_DIR = path.join(process.cwd(), 'public', 'cache', 'img')

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const src = url.searchParams.get('src')
  const w = parseInt(url.searchParams.get('w') || '800', 10)
  const q = parseInt(url.searchParams.get('q') || '70', 10)

  if (!src) return NextResponse.json({ error: 'src required' }, { status: 400 })

  // Normalize source path
  const normalizedSrc = src.replace(/^\/api\/uploads\//, '/uploads/')

  // Path traversal protection: resolve the requested path and verify it stays
  // within the public/ directory. Using path.resolve() collapses any `..`
  // segments, and startsWith() ensures the final path is contained.
  const publicDir = path.resolve(process.cwd(), 'public')
  const requestedPath = path.resolve(publicDir, normalizedSrc)
  if (!requestedPath.startsWith(publicDir + path.sep) && requestedPath !== publicDir) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const filePath = requestedPath
  const safePath = path.relative(publicDir, requestedPath)

  // Generate cache key: sha256(src + w + q)
  const cacheKey = crypto.createHash('sha256').update(`${safePath}-${w}-${q}`).digest('hex').slice(0, 32)
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.webp`)

  // ── Cache hit: stream the cached file directly (no sharp processing) ──
  if (existsSync(cachePath)) {
    try {
      const fileStat = await stat(cachePath)
      if (fileStat.size > 0) {
        const stream = createReadStream(cachePath)
        const webStream = Readable.toWeb(stream) as ReadableStream
        return new Response(webStream, {
          headers: {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      }
    } catch {
      // Cache file corrupted — fall through to re-generate
    }
  }

  // ── Cache miss: run sharp and save to cache ──
  try {
    const buffer = await readFile(filePath)
    const output = await sharp(buffer)
      .resize(w, null, { withoutEnlargement: true })
      .webp({ quality: q })
      .toBuffer()

    // Save to cache (best-effort — don't fail if cache write fails)
    try {
      if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true })
      const { writeFile } = await import('fs/promises')
      await writeFile(cachePath, output)
    } catch {
      // Cache write failed (disk full, permissions) — non-fatal
    }

    return new NextResponse(new Uint8Array(output), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'image not found' }, { status: 404 })
  }
}
