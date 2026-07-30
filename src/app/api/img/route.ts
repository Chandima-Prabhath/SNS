import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sharp from 'sharp'
import { readFile } from 'fs/promises'
import path from 'path'

/**
 * GET /api/img?src=/uploads/xxx.png&w=400&q=60
 *
 * Server-side image optimization using sharp.
 * Generates a resized, compressed version of the original image.
 * Used for progressive loading: fetch a small version first (w=40, q=30),
 * then upgrade to a larger version.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const src = url.searchParams.get('src')
  const w = parseInt(url.searchParams.get('w') || '800', 10)
  const q = parseInt(url.searchParams.get('q') || '70', 10)

  if (!src) return NextResponse.json({ error: 'src required' }, { status: 400 })

  // Normalize source path — /api/uploads/xxx.png and /uploads/xxx.png both
  // point to the same file on disk (public/uploads/xxx.png). Strip /api prefix.
  const normalizedSrc = src.replace(/^\/api\/uploads\//, '/uploads/')
  const safePath = normalizedSrc.replace(/\.\./g, '').replace(/^\//, '')
  const filePath = path.join(process.cwd(), 'public', safePath)

  try {
    const buffer = await readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    let pipeline = sharp(buffer).resize(w, null, { withoutEnlargement: true })

    if (ext === '.png') {
      pipeline = pipeline.png({ quality: q, compressionLevel: 9 })
    } else if (ext === '.webp') {
      pipeline = pipeline.webp({ quality: q })
    } else {
      pipeline = pipeline.jpeg({ quality: q, progressive: true })
    }

    const output = await pipeline.toBuffer()

    return new NextResponse(output, {
      headers: {
        'Content-Type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'image not found' }, { status: 404 })
  }
}
