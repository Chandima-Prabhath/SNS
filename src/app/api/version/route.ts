import { NextResponse } from 'next/server'
import { readFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

// Disable caching
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/version
 *
 * Returns the current app version hash. Used by UpdateBanner to detect
 * when a new build has been deployed.
 *
 * We generate a hash from:
 *   - .next/BUILD_ID (if it exists)
 *   - package.json modification time
 *   - server.ts modification time
 *
 * If BUILD_ID doesn't exist (dev mode), we fall back to file modification
 * times which change on every deploy.
 */
export async function GET() {
  let version: string | null = null

  try {
    // Try BUILD_ID first (production)
    const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID')
    if (existsSync(buildIdPath)) {
      version = readFileSync(buildIdPath, 'utf-8').trim()
    }
  } catch {
    // ignore
  }

  // Fallback: hash of file modification times
  if (!version) {
    try {
      const files = ['package.json', 'server.ts', 'src/app/layout.tsx']
      const stats: string[] = []
      for (const f of files) {
        const fp = path.join(process.cwd(), f)
        if (existsSync(fp)) {
          stats.push(`${f}:${statSync(fp).mtimeMs}`)
        }
      }
      // Also include the .next directory modification time
      const nextDir = path.join(process.cwd(), '.next')
      if (existsSync(nextDir)) {
        stats.push(`.next:${statSync(nextDir).mtimeMs}`)
      }
      version = crypto.createHash('md5').update(stats.join('|')).digest('hex').slice(0, 12)
    } catch {
      version = null
    }
  }

  return NextResponse.json(
    {
      version,
      timestamp: Date.now(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  )
}
