/**
 * Adoo Service Worker
 *
 * Responsibilities:
 *   - Cache app shell for offline use
 *   - Handle push notifications (incoming calls, messages) — works in background
 *   - Notification click → focus/open the app
 *   - Background sync (future)
 */

const CACHE_NAME = 'adoo-v2'
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

// Activate — clean old caches + claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch — network-first for navigations, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  // Navigations → network-first
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

  // Static assets → cache-first (but NOT uploads or API routes)
  if (req.url.includes('/_next/') || req.url.includes('/rnnoise')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
          }
          return res
        })
      })
    )
    return
  }

  // Everything else (API routes, uploads, etc.) → always go to network
  // Don't cache — these are dynamic
})

// Push — background notifications (works even when app is closed)
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Adoo', body: event.data?.text() || 'New notification' }
  }

  const { type, title, body, callId, from, channelId } = payload

  let options = {
    body: body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: type || 'adoo-notification',
    renotify: true,
    data: { callId, type, channelId, url: '/' },
  }

  // Call-style notification — high priority, stays until user interacts
  if (type === 'call') {
    options = {
      ...options,
      tag: `call-${callId}`,
      requireInteraction: true,
      silent: false,
      vibrate: [200, 100, 200, 100, 200, 100, 200],
      actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' },
      ],
      data: { callId, type, channelId, from, url: '/' },
    }
  }

  // Message notification — auto-dismiss after 4s
  if (type === 'message') {
    options = {
      ...options,
      tag: `msg-${channelId}`,
      requireInteraction: false,
      silent: false,
      vibrate: [100],
    }
  }

  event.waitUntil(
    self.registration.showNotification(title || 'Adoo', options)
  )
})

// Notification click — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const { action, notification } = event
  const data = notification.data || {}

  // Focus or open the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab
      for (const client of clients) {
        if ('focus' in client) {
          // Send message to the app about the notification click
          client.postMessage({ type: 'notification_click', action, ...data })
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

// Message from the app (e.g., to close a call notification)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'close-notification') {
    self.registration.getNotifications({ tag: event.data.tag }).then((notifications) => {
      notifications.forEach((n) => n.close())
    })
  }
})
