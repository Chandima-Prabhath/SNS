/**
 * Push notification utility — sends web push notifications to ALL subscribed
 * devices for a user. Supports multi-device: each device registers its own
 * PushSubscription, and sendPushNotification iterates all of them.
 *
 * Uses the web-push library with VAPID authentication.
 * Requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env.
 */
import webpush from 'web-push'
import { db } from '@/lib/db'

let configured = false

function configure() {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return

  webpush.setVapidDetails(
    'mailto:noreply@adoo.app',
    publicKey,
    privateKey
  )
  configured = true
}

/**
 * Send a push notification to ALL of a user's subscribed devices.
 * Each device has its own PushSubscription row (keyed by endpoint URL).
 * Expired subscriptions (410/404) are automatically removed.
 */
export async function sendPushNotification(
  userId: string,
  payload: {
    type: 'call' | 'message' | 'story'
    title: string
    body: string
    callId?: string
    channelId?: string
    from?: { userId: string; username: string; displayName: string }
  }
) {
  configure()
  if (!configured) return

  // Get ALL push subscriptions for this user (multi-device)
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
  })

  if (subscriptions.length === 0) return

  const payloadStr = JSON.stringify(payload)

  // Send to all devices in parallel — one slow/expired device
  // shouldn't block notifications to other devices
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      let keys: any
      try {
        keys = JSON.parse(sub.keys)
      } catch {
        keys = {}
      }

      const pushSubscription = {
        endpoint: sub.endpoint,
        keys,
      }

      try {
        await webpush.sendNotification(pushSubscription, payloadStr)
      } catch (e: any) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — remove it
          await db.pushSubscription.delete({
            where: { id: sub.id },
          }).catch(() => {})
        }
        // Other errors (network, 429) — don't remove, just skip
      }
    })
  )
}
