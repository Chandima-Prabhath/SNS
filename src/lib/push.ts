/**
 * Push notification utility — sends web push notifications to subscribed users.
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
 * Send a push notification to a specific user.
 * The user must have a push subscription stored in UserSetting.
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

  // Get the user's push subscription
  const setting = await db.userSetting.findUnique({
    where: { userId_key: { userId, key: 'pushSubscription' } },
  })
  if (!setting) return

  let subscription: any
  try {
    subscription = JSON.parse(setting.value)
  } catch {
    return
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
  } catch (e: any) {
    if (e.statusCode === 410 || e.statusCode === 404) {
      // Subscription expired — remove it
      await db.userSetting.delete({
        where: { userId_key: { userId, key: 'pushSubscription' } },
      }).catch(() => {})
    }
  }
}
