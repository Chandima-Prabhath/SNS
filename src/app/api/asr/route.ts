import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { transcribeMediaUrl } from '@/lib/asr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/asr — Transcribe an audio file (typically a voice message).
 *
 * Body: { mediaUrl: string, messageId?: string, language?: string }
 *   - mediaUrl:   the path returned by /api/upload (e.g. "/api/uploads/voice-xxx.webm")
 *   - messageId:  optional — if provided, the Message row's `transcript` field
 *                 is updated with the result. Useful for "show transcript" buttons
 *                 in the chat UI.
 *   - language:   optional language hint (currently ignored — Moonshine v1 is
 *                 English-only, but future versions will support it)
 *
 * Returns: { text: string, duration_sec: number, model: string, processing_ms: number }
 *
 * Auth: requires a logged-in session. The proxy pattern keeps the ASR server
 * URL private and lets us add rate-limiting / audit logging later.
 *
 * Why a proxy? The Python ASR server has no auth — it trusts whatever calls
 * it on the private network. By going through this Next.js route, every
 * transcription request is auth-gated by the user's session.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { mediaUrl, messageId, language } = body as {
      mediaUrl?: string
      messageId?: string
      language?: string
    }

    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return NextResponse.json({ error: 'mediaUrl required' }, { status: 400 })
    }

    // Sanity-check the URL — must be an /api/uploads/ path, not arbitrary
    if (!mediaUrl.startsWith('/api/uploads/') && !mediaUrl.startsWith('/uploads/')) {
      return NextResponse.json(
        { error: 'mediaUrl must point to a local upload' },
        { status: 400 },
      )
    }

    // If a messageId is provided, verify the caller can access that message's
    // channel — prevents transcribing other people's DMs.
    if (messageId) {
      const msg = await db.message.findUnique({
        where: { id: messageId },
        select: { channelId: true },
      })
      if (!msg) {
        return NextResponse.json({ error: 'message not found' }, { status: 404 })
      }

      // Verify channel membership
      const membership = await db.channelMember.findFirst({
        where: { channelId: msg.channelId, userId: (session.user as any).id },
      })
      if (!membership) {
        return NextResponse.json(
          { error: 'not a member of this channel' },
          { status: 403 },
        )
      }
    }

    // Transcribe
    const transcript = await transcribeMediaUrl(mediaUrl, language || 'en')

    if (transcript === null) {
      return NextResponse.json(
        { error: 'transcription failed — is the ASR server running?' },
        { status: 502 },
      )
    }

    // Persist to the Message row if requested
    if (messageId) {
      try {
        await db.message.update({
          where: { id: messageId },
          data: { transcript },
        })
      } catch (e: any) {
        console.error('[asr] failed to persist transcript:', e?.message || e)
        // non-fatal — caller still gets the text
      }
    }

    return NextResponse.json({
      text: transcript,
      mediaUrl,
      messageId: messageId || null,
    })
  } catch (e: any) {
    console.error('[asr] route error:', e?.message || e)
    return NextResponse.json(
      { error: 'internal error', detail: e?.message || String(e) },
      { status: 500 },
    )
  }
}

/**
 * GET /api/asr — health check for the ASR server.
 * Returns whether the Python sidecar is reachable and whether the model
 * is loaded. Used by the chat UI to decide whether to show "Show transcript"
 * buttons.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const { checkAsrHealth } = await import('@/lib/asr')
    const health = await checkAsrHealth()
    return NextResponse.json(health)
  } catch (e: any) {
    return NextResponse.json(
      { reachable: false, loaded: false, error: e?.message || String(e) },
      { status: 200 },
    )
  }
}
