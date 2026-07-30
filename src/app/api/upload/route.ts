import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

// Force Node.js runtime + dynamic route. Uploads involve streaming FormData
// parsing and synchronous disk writes — must always run on Node.js, never
// edge/static-optimized.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Avoid stat-ing the upload dir on every request after the first time.
let uploadDirEnsured = false

/**
 * POST /api/upload — Save an uploaded file to public/uploads/ and return its
 * public URL + MIME type.
 *
 * Body: multipart/form-data with a `file` field.
 * Returns: { url: string, type: string, size: number, name: string }
 *
 * Used by:
 *   - chat message composer (image/video/audio attachments)
 *   - chat voice messages (MediaRecorder output — audio/webm / audio/mp4)
 *   - TTS custom voice clips
 *   - settings avatar upload
 *   - status media upload
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 })
    }

    // Cap uploads at ~25MB to protect the server.
    const MAX_SIZE = 25 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'file too large (max 25MB)' },
        { status: 413 }
      )
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!uploadDirEnsured && !existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }
    uploadDirEnsured = true

    // Build a safe, collision-free filename. Preserve the original extension
    // when we can so mediaType detection + browser playback keep working.
    const ext = path.extname(file.name || '').toLowerCase().slice(0, 8) || '.bin'
    const safeExt = /^[\w.-]+$/.test(ext) ? ext : '.bin'
    const filename = `${Date.now()}-${crypto.randomUUID()}${safeExt}`
    const filePath = path.join(uploadDir, filename)

    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(filePath, bytes)

    return NextResponse.json({
      url: `/uploads/${filename}`,
      type: file.type || 'application/octet-stream',
      size: file.size,
      name: file.name || filename,
    })
  } catch (e: any) {
    console.error('[upload] error:', e)
    return NextResponse.json(
      { error: e?.message || 'Upload failed' },
      { status: 500 }
    )
  }
}
