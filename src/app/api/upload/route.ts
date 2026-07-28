import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

// Images: 8MB (typically compressed client-side first, so this is the safety net)
// Videos: 50MB — can't easily compress client-side without ffmpeg.wasm
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'no file provided' }, { status: 400 })
    }

    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const maxSize = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
    const maxLabel = isVideo ? '50MB' : '8MB'

    if (file.size > maxSize) {
      return NextResponse.json({ error: `file too large (max ${maxLabel})` }, { status: 413 })
    }

    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
    ]
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: `unsupported file type: ${file.type}` }, { status: 415 })
    }

    // Save to public/uploads/ — the URL is /uploads/filename
    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'bin'
    const name = `${crypto.randomUUID()}.${safeExt}`
    const filePath = path.join(uploadDir, name)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    return NextResponse.json({
      url: `/uploads/${name}`,
      type: file.type,
      size: file.size,
    })
  } catch (e: any) {
    console.error('[upload] error:', e)
    return NextResponse.json(
      { error: e?.message || 'upload failed' },
      { status: 500 }
    )
  }
}
