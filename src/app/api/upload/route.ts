import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveUpload, MAX_UPLOAD_SIZE, validateExtension } from '@/lib/media'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/upload — Upload a file (image, video, audio, document).
 *
 * Multipart form: file = <File>
 * Returns: { url, type, size, name }
 *
 * Uses the shared media service (src/lib/media.ts) for:
 *   - Extension validation (allowlist blocks SVG/HTML/JS)
 *   - Unique filename generation (timestamp-uuid.ext)
 *   - Consistent storage path (public/uploads/)
 *   - MIME type detection
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

    if (file.size > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: 'file too large (max 25MB)' }, { status: 413 })
    }

    // Validate extension BEFORE saving
    const ext = path.extname(file.name || '').toLowerCase()
    const safeExt = validateExtension(ext)
    if (!safeExt) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 403 })
    }

    // Read file into buffer
    const bytes = new Uint8Array(await file.arrayBuffer())

    // Save via media service
    const result = await saveUpload(bytes, file.name || `upload${safeExt}`, file.type)

    return NextResponse.json({
      url: result.url,
      type: result.mimeType,
      size: result.size,
      name: file.name || result.filename,
    })
  } catch (e: any) {
    console.error('[upload] error:', e)
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
