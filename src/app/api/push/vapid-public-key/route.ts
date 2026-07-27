import { NextResponse } from 'next/server'

/**
 * GET /api/push/vapid-public-key
 * Returns the VAPID public key for the client to use for push subscription.
 * If VAPID is not configured, returns 200 with null (client handles gracefully).
 */
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) {
    // Return 200 with null instead of 500 — the client checks for this
    return NextResponse.json({ publicKey: null, error: 'VAPID not configured. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to .env. Generate with: npx web-push generate-vapid-keys' })
  }
  return NextResponse.json({ publicKey })
}
