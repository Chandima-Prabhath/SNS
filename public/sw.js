/**
 * Adoo Service Worker
 *
 * Responsibilities:
 *   - Cache app shell for offline use
 *   - Handle push notifications (incoming calls, messages)
 *   - Notification click → focus/open the app
 *
 * Note: Notification.action buttons (Answer/Decline) are NOT supported on
 * Chrome Android — they only work on desktop. On mobile, tapping the
 * notification opens the app, which shows the IncomingCallOverlay.
 */

const CACHE_NAME = 'adoo-v1'
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon.svg',
]

// Install — cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  )
  self.skipWaiting()
})

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch — network-first for navigations, cache-first for assets
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  // Navigations → network-first (always get fresh HTML)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    )
    return
  }

  // Static assets → cache-first
  if (req.url.includes('/_next/') || req.url.includes('/uploads/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
          return res
        })
      })
    )
    return
  }
})

// Push — show notification
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Adoo', body: event.data?.text() || 'New notification' }
  }

  const { type, title, body, callId, from } = payload

  let options = {
    body: body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: callId || type || 'adoo-notification',
    renotify: true,
    data: { callId, type, url: '/' },
  }

  // Call-style notification — high priority
  if (type === 'call') {
    options = {
      ...options,
      tag: `call-${callId}`,
      requireInteraction: true, // stays until user interacts
      silent: false,
      vibrate: [200, 100, 200, 100, 200, 100, 200],
      actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' },
      ],
    }
  }

  event.waitUntil(
    self.registration.showNotification(title || 'Adoo', options)
  )
})

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const { action, notification } = event
  const data = notification.data || {}

  if (action === 'decline' && data.callId) {
    // TODO: send decline via postMessage to the app
  }

  // Focus or open the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification_click', ...data, action })
          return client.focus()
        }
      }
      // Open new tab
      if (self.clients.openWindow) {
        return self.clients.openWindow(data.url || '/')
      }
    })
  )
})
