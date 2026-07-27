/**
 * Adoo Service Worker
 */

const CACHE_NAME = 'adoo-v3'
const APP_SHELL = ['/', '/manifest.json', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  // Navigations → network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
        return res
      }).catch(() => caches.match(req).then((r) => r || caches.match('/')))
    )
    return
  }

  // Static assets → cache-first (but NOT uploads or API)
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

  // Uploaded images → cache-first with 404 protection
  // Cache successful responses but NEVER cache 404s
  if (req.url.includes('/uploads/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          // Only cache successful responses
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
})

// Push — background notifications
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Adoo', body: event.data?.text() || 'New notification' }
  }

  const { type, title, body, callId, channelId, from } = payload

  let options = {
    body: body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: type || 'adoo-notification',
    renotify: true,
    data: { callId, type, channelId, from, url: '/' },
  }

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
      // Build a deep-link URL so the app opens to the right place
      data: { callId, type, channelId, from, url: `/?view=voice&callId=${callId}` },
    }
  }

  if (type === 'message') {
    options = {
      ...options,
      tag: `msg-${channelId}`,
      requireInteraction: false,
      vibrate: [100],
      // Deep-link to the specific chat
      data: { callId, type, channelId, from, url: `/?view=chats&channel=${channelId}` },
    }
  }

  event.waitUntil(self.registration.showNotification(title || 'Adoo', options))
})

// Notification click — open app with deep-link URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { action, notification } = event
  const data = notification.data || {}
  const targetUrl = data.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab and navigate
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification_click', action, ...data })
          // Navigate the existing client to the target URL
          if ('navigate' in client) {
            client.navigate(targetUrl)
          }
          return client.focus()
        }
      }
      // Open new tab with the deep-link URL
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'close-notification') {
    self.registration.getNotifications({ tag: event.data.tag }).then((notifications) => {
      notifications.forEach((n) => n.close())
    })
  }
})
