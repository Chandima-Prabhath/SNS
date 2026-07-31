import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let uploadDirEnsured = false

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 })
    }

    const MAX_SIZE = 25 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'file too large (max 25MB)' }, { status: 413 })
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!uploadDirEnsured && !existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }
    uploadDirEnsured = true

    const ext = path.extname(file.name || '').toLowerCase().slice(0, 8) || '.bin'
    const safeExt = /^[\w.-]+$/.test(ext) ? ext : '.bin'

    // Extension allowlist — reject SVG, HTML, JS, etc. (XSS prevention)
    const ALLOWED_EXTENSIONS = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
      '.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac',
      '.mp4', '.mov', '.avi',
      '.pdf', '.txt',
      '.safetensors', '.bin',
    ])
    if (!ALLOWED_EXTENSIONS.has(safeExt)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 403 })
    }

    const filename = `${Date.now()}-${crypto.randomUUID()}${safeExt}`
    const filePath = path.join(uploadDir, filename)

    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(filePath, bytes)

    // Determine the MIME type. Prefer file.type (set by the browser), but
    // fall back to detecting from the extension. This matters because:
    //   - Some browsers don't set file.type for Blob-created Files
    //   - WebM audio recordings can get tagged as 'video/webm' by some browsers
    //   - The caller (message-composer) uses this type to decide how to render
    //     the message (audio player vs video element vs image)
    const EXT_MIME: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',   // WebM from voice recordings is audio, not video
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
    }
    const detectedType = file.type && file.type !== 'application/octet-stream'
      ? file.type
      : (EXT_MIME[safeExt] || 'application/octet-stream')

    return NextResponse.json({
      url: `/api/uploads/${filename}`,
      type: detectedType,
      size: file.size,
      name: file.name || filename,
    })
  } catch (e: any) {
    console.error('[upload] error:', e)
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
