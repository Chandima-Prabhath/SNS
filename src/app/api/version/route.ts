import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

// Disable caching — this endpoint must always return fresh data
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/version
 *
 * Returns the current app version. This is used by the UpdateBanner to
 * detect when a new build has been deployed — even if the service worker
 * hasn't changed.
 *
 * The version is based on the build time of the Next.js app. We read the
 * .next/BUILD_ID file which Next.js generates on every build.
 *
 * The UpdateBanner polls this endpoint every 60 seconds and compares the
 * version to the one it saw on page load. If they differ, it shows the
 * "Update available" banner.
 */
export async function GET() {
  let buildId: string | null = null

  try {
    const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID')
    if (existsSync(buildIdPath)) {
      buildId = readFileSync(buildIdPath, 'utf-8').trim()
    }
  } catch {
    // .next/BUILD_ID might not exist in dev mode
  }

  return NextResponse.json(
    {
      buildId,
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
