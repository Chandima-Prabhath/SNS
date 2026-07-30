import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Force dynamic Node.js route — proxies to a local Ollama instance.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/llm/models — List models available on the local Ollama instance.
 *
 * Proxies to OLLAMA_URL/api/tags (default: http://localhost:11434).
 * Returns: { models: [{ name, size, modified }], online: boolean }
 *
 * Used by the bot builder's AI Generate node inspector to populate the model
 * dropdown. If Ollama is offline or unreachable, returns an empty model list
 * with online=false so the UI can show a warning instead of crashing.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'

  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      // Short timeout — if Ollama isn't running, don't hang the inspector
      signal: AbortSignal.timeout(3000),
    })

    if (!res.ok) {
      console.error(`[llm/models] Ollama returned ${res.status}`)
      return NextResponse.json({
        models: [],
        online: false,
        error: `Ollama returned ${res.status}`,
      })
    }

    const data = await res.json()
    const models = (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
      // Ollama returns details like parameter count, quantization, etc.
      details: m.details ? {
        family: m.details.family,
        parameterSize: m.details.parameter_size,
        quantizationLevel: m.details.quantization_level,
      } : undefined,
    }))

    return NextResponse.json({ models, online: true })
  } catch (e: any) {
    console.error('[llm/models] failed to reach Ollama:', e?.message || e)
    return NextResponse.json({
      models: [],
      online: false,
      error: e?.message || 'Ollama unreachable',
    })
  }
}
