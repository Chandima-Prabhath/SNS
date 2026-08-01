'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Permission Manager — asks for notification permission on first login.
 * Registers push subscription with the server using VAPID keys.
 */
export function usePermissionManager() {
  const { status } = useSession()

  useEffect(() => {
    if (status !== 'authenticated') return

    // Check and request notification permission
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        const timer = setTimeout(() => {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
              console.log('[permissions] notification permission granted')
              registerPushSubscription()
            }
          })
        }, 3000)
        return () => clearTimeout(timer)
      } else if (Notification.permission === 'granted') {
        registerPushSubscription()
      }
    }

    // Check microphone permission
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((result) => {
        if (result.state === 'prompt') {
          console.log('[permissions] microphone not yet granted — will ask on first call')
        }
      }).catch(() => {})
    }
  }, [status])
}

async function registerPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const registration = await navigator.serviceWorker.ready

    // Check if we already have a subscription
    let subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      // Re-send to server in case it was lost
      await sendSubscriptionToServer(subscription)
      return
    }

    // Get VAPID public key from server
    const response = await fetch('/api/push/vapid-public-key')
    if (!response.ok) {
      console.log('[permissions] VAPID endpoint failed')
      return
    }
    const data = await response.json()
    if (!data.publicKey) {
      console.log('[permissions] VAPID not configured on server — push notifications disabled')
      console.log('[permissions] To enable: generate keys with "npx web-push generate-vapid-keys" and add VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY to .env')
      return
    }
    const { publicKey } = data

    // Convert VAPID key to Uint8Array
    const convertedKey = urlBase64ToUint8Array(publicKey)

    // Subscribe
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertedKey as BufferSource,
    })

    // Send to server
    await sendSubscriptionToServer(subscription)
    console.log('[permissions] push subscription registered')
  } catch (e) {
    console.warn('[permissions] push subscription failed:', e)
  }
}

async function sendSubscriptionToServer(subscription: PushSubscription) {
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  })
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
