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
    const filename = `${Date.now()}-${crypto.randomUUID()}${safeExt}`
    const filePath = path.join(uploadDir, filename)

    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeFile(filePath, bytes)

    return NextResponse.json({
      url: `/api/uploads/${filename}`,
      type: file.type || 'application/octet-stream',
      size: file.size,
      name: file.name || filename,
    })
  } catch (e: any) {
    console.error('[upload] error:', e)
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
