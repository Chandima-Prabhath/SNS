import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createReadStream, statSync, existsSync } from 'fs'
import { Readable } from 'stream'
import path from 'path'

// Force dynamic Node.js route — we read from disk on every request.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Allowed file extensions — blocks SVG (XSS), HTML, JS, etc.
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
  '.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac',
  '.mp4', '.mov', '.avi',
  '.pdf', '.txt',
  '.safetensors',
  '.bin',
])

// MIME type map for common upload extensions. Browsers need the correct
// Content-Type to play audio/video inline.
const MIME_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm-video': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.bin': 'application/octet-stream',
}

/**
 * GET /api/uploads/[filename] — Serve an uploaded file from public/uploads/.
 *
 * WHY THIS EXISTS:
 *   Next.js's built-in static file serving for `public/` can cache file
 *   existence checks or return stale 404s for files added at runtime in
 *   production mode. This caused newly-uploaded TTS audio to appear as
 *   0:00/0:00 unplayable until the server was restarted. By serving files
 *   through a dedicated API route that reads from disk on every request,
 *   we bypass all static-file caching and guarantee the file is served
 *   immediately after /api/upload writes it.
 *
 * Supports HTTP Range requests for audio/video seeking.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    // Auth check — require an authenticated session
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { filename } = await params

    // Sanitize filename — prevent path traversal (../../etc/passwd etc.)
    if (!filename || !/^[\w\-.]+$/.test(filename)) {
      return new NextResponse('Invalid filename', { status: 400 })
    }

    // Extension allowlist — blocks SVG (XSS), HTML, JS, etc.
    const ext = path.extname(filename).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return new NextResponse('File type not allowed', { status: 403 })
    }

    const filePath = path.join(process.cwd(), 'public', 'uploads', filename)

    // Prevent path traversal — resolved path must be inside uploads/
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    if (!filePath.startsWith(uploadsDir + path.sep)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    if (!existsSync(filePath)) {
      console.warn(`[uploads] file not found: ${filename}`)
      return new NextResponse('Not found', { status: 404 })
    }

    const fileStat = statSync(filePath)
    if (fileStat.size === 0) {
      console.warn(`[uploads] file is 0 bytes: ${filename}`)
      return new NextResponse('File is empty', { status: 500 })
    }

    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    // Check for Range header (audio/video seeking)
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? parseInt(match[2], 10) : fileStat.size - 1

        if (start >= fileStat.size || end >= fileStat.size || start > end) {
          return new NextResponse('Range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileStat.size}` },
          })
        }

        const chunkSize = end - start + 1
        // STREAM instead of buffering — avoids loading entire file into RAM.
        // On a 1GB VM, buffering a 50MB video would consume 50MB of heap.
        const stream = createReadStream(filePath, { start, end })
        const webStream = Readable.toWeb(stream) as ReadableStream

        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }
    }

    // No range — serve the full file as a stream
    const stream = createReadStream(filePath)
    const webStream = Readable.toWeb(stream) as ReadableStream

    return new Response(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileStat.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (e: any) {
    console.error('[uploads] error:', e)
    return new NextResponse('Internal error', { status: 500 })
  }
}
