'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Permission Manager — asks for notification permission on first login.
 * Also registers push subscription with the server (if supported).
 *
 * Mounted once at the app root. Checks permissions on every authentication.
 */
export function usePermissionManager() {
  const { status } = useSession()

  useEffect(() => {
    if (status !== 'authenticated') return

    // Check and request notification permission
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        // Don't ask immediately — wait 3 seconds so the user sees the app first
        const timer = setTimeout(() => {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              console.log('[permissions] notification permission granted')
              // Register push subscription if service worker is ready
              registerPushSubscription()
            }
          })
        }, 3000)
        return () => clearTimeout(timer)
      } else if (Notification.permission === 'granted') {
        registerPushSubscription()
      }
    }

    // Check microphone permission (for calls)
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((result) => {
        if (result.state === 'prompt') {
          console.log('[permissions] microphone permission not yet granted — will ask on first call')
        }
      }).catch(() => {})
    }
  }, [status])
}

/**
 * Register a push subscription with the service worker.
 * Sends the subscription to the server for later use.
 */
async function registerPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const registration = await navigator.serviceWorker.ready

    // Check if we already have a subscription
    let subscription = await registration.pushManager.getSubscription()
    if (subscription) return // already subscribed

    // For now, we don't have VAPID keys set up — just log that push is available
    // When VAPID keys are configured, uncomment the code below:
    //
    // const response = await fetch('/api/push/vapid-public-key')
    // const vapidPublicKey = await response.text()
    // const convertedKey = urlBase64ToUint8Array(vapidPublicKey)
    // subscription = await registration.pushManager.subscribe({
    //   userVisibleOnly: true,
    //   applicationServerKey: convertedKey,
    // })
    // await fetch('/api/push/subscribe', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(subscription),
    // })
    // console.log('[permissions] push subscription registered')

    console.log('[permissions] push manager ready (VAPID not configured)')
  } catch (e) {
    console.warn('[permissions] push subscription failed:', e)
  }
}
