import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads')
const MAX_BYTES = 8 * 1024 * 1024 // 8MB

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'no file' }, { status: 400 })

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large (max 8MB)' }, { status: 413 })
  }

  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav']
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: `unsupported file type: ${file.type}` }, { status: 415 })
  }

  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'bin'
  const name = `${crypto.randomUUID()}.${safeExt}`
  const filePath = path.join(UPLOAD_DIR, name)
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  return NextResponse.json({
    url: `/uploads/${name}`,
    type: file.type,
    size: file.size,
  })
}
