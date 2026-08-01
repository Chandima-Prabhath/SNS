/**
 * Adoo Service Worker v6
 * - App shell caching (versioned)
 * - Network-first navigations with offline fallback
 * - Cache-first for static assets (_next, rnnoise)
 * - Cache-first for uploads (images, audio)
 * - Stale-while-revalidate for API GET requests (enables offline reading)
 * - SKIP_WAITING message handler
 * - Push notifications
 *
 * Offline support:
 *   When the network is down, the SW serves cached API responses so the user
 *   can still read messages, see channels, and browse music history. POST
 *   requests (sending messages, etc.) will fail gracefully.
 */

const CACHE_NAME = 'adoo-v14'
const API_CACHE = 'adoo-api-v14'
const APP_SHELL = ['/', '/manifest.json', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME && k !== API_CACHE).map((k) => {
        console.log('[sw] deleting old cache:', k)
        return caches.delete(k)
      })
    )).then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[sw] received SKIP_WAITING, activating...')
    self.skipWaiting()
  }
  if (event.data?.type === 'close-notification') {
    self.registration.getNotifications({ tag: event.data.tag }).then((notifications) => {
      notifications.forEach((n) => n.close())
    })
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // ─── Navigations → network-first with offline fallback ────────────────
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

  // ─── Static assets → cache-first ──────────────────────────────────────
  if (url.pathname.includes('/_next/') || url.pathname.includes('/rnnoise') || url.pathname.includes('/sw.js') || url.pathname.includes('/manifest.json')) {
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

  // ─── Uploaded files → network-first (always try network, cache on success) ──
  // This prevents stale/empty cached responses for newly uploaded files.
  // Matches both /uploads/ (legacy static serving) and /api/uploads/ (our
  // dedicated file-serving route that bypasses Next.js static caching).
  if (url.pathname.includes('/uploads/')) {
    event.respondWith(
      fetch(req).then((res) => {
        // Only cache full (200) responses — NOT 206 partial/range responses.
        // The Cache API doesn't support partial responses and throws:
        // "Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported"
        if (res.status === 200 && res.headers.get('content-length') !== '0') {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
        }
        return res
      }).catch(() => {
        // Offline — serve from cache (but only if we have a full 200 cached)
        return caches.match(req).then((r) => r || new Response('Offline', { status: 503 }))
      })
    )
    return
  }

  // ─── Music stream → cache-first (cached songs play offline) ───────────
  if (url.pathname.includes('/api/music/stream/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          if (res.ok || res.status === 206) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
          }
          return res
        }).catch(() => {
          // Offline — return cached version if available
          return caches.match(req).then((r) => r || new Response('Offline', { status: 503 }))
        })
      })
    )
    return
  }

  // ─── API GET requests → network-first with cache fallback ─────────────
  // Network-first: always try the network first. If the network succeeds,
  // cache the fresh response and return it. If the network fails (offline),
  // fall back to the cached version.
  //
  // This is CRITICAL for write-then-read flows: after uploading a status,
  // creating a playlist, or sending a message, the next GET must see the
  // fresh data immediately — not a stale cached version.
  //
  // The previous stale-while-revalidate approach served stale cache first
  // and updated in the background, causing delays where mutations weren't
  // visible until a manual refresh.
  if (url.pathname.startsWith('/api/') && !url.pathname.includes('/api/tts') && !url.pathname.includes('/api/music/stream') && !url.pathname.includes('/api/upload') && !url.pathname.includes('/api/music/debug') && !url.pathname.includes('/api/version') && !url.pathname.includes('/api/music/search') && !url.pathname.includes('/api/music/related') && !url.pathname.includes('/api/music/predownload') && !url.pathname.includes('/api/uploads/') && !url.pathname.includes('/api/asr')
    // Exclude frequently-polled routes from caching — their data changes
    // too fast and stale cache causes UX bugs (wrong unread counts, old
    // channel lists, stale presence).
    && !url.pathname.includes('/api/unread')
    && !url.pathname.includes('/api/channels')
    && !url.pathname.includes('/api/calls/pending')
  ) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        try {
          // Try network first
          const res = await fetch(req)
          // Cache successful FULL (200) JSON responses only — not 206 partials
          if (res.status === 200 && res.headers.get('content-type')?.includes('application/json')) {
            const copy = res.clone()
            cache.put(req, copy)
            // ── LRU eviction: keep cache under MAX_ENTRIES ──
            // Prevents the cache from growing unbounded and hitting
            // browser storage quota after extended use.
            const MAX_ENTRIES = 200
            const keys = await cache.keys()
            if (keys.length > MAX_ENTRIES) {
              // Delete oldest entries (first-in-first-out)
              const toDelete = keys.slice(0, keys.length - MAX_ENTRIES)
              await Promise.all(toDelete.map((key) => cache.delete(key)))
            }
          }
          return res
        } catch {
          // Network failed — fall back to cache (offline mode)
          const cached = await cache.match(req)
          if (cached) return cached
          // No cache either — return a 503
          return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      })
    )
    return
  }
})

// ─── Push notifications ─────────────────────────────────────────────────
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
      data: { callId, type, channelId, from, url: `/?view=voice&callId=${callId}` },
    }
  }

  if (type === 'message') {
    options = {
      ...options,
      tag: `msg-${channelId}`,
      requireInteraction: false,
      vibrate: [100],
      data: { callId, type, channelId, from, url: `/?view=chats&channel=${channelId}` },
    }
  }

  event.waitUntil(self.registration.showNotification(title || 'Adoo', options))
})

// ─── Notification click ─────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { action, notification } = event
  const data = notification.data || {}
  const targetUrl = data.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification_click', action, ...data })
          if ('navigate' in client) {
            client.navigate(targetUrl)
          }
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
