'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * UpdateBanner — shows a notification when a new service worker update is
 * available. The user can click "Update" to reload the page and activate
 * the new SW, or dismiss the banner.
 *
 * How it works:
 *   1. On mount, we register the service worker.
 *   2. We immediately check for updates (not just every 10 min).
 *   3. We listen for 'updatefound' events — a new SW is installing.
 *   4. When the new SW reaches 'installed' state (and there's an existing
 *      controller), we show the banner.
 *   5. On "Update" click, we post SKIP_WAITING to the waiting SW and reload
 *      once the new SW takes control.
 *
 * The key fix: we check for updates on EVERY page load, not just every 10
 * minutes. This ensures the banner appears promptly after a deployment.
 */
export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    let mounted = true

    const handleUpdate = (reg: ServiceWorkerRegistration) => {
      if (!mounted) return
      // A new SW is waiting to activate
      if (reg.waiting) {
        console.log('[update-banner] waiting SW detected')
        setUpdateAvailable(true)
        setRegistration(reg)
      }
      // Listen for a new SW installing
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New SW installed and there's an existing one — update ready
            console.log('[update-banner] new SW installed, update ready')
            setUpdateAvailable(true)
            setRegistration(reg)
          }
        })
      })
    }

    // Register the service worker and immediately check for updates.
    // This is the key fix — we check on every page load, not just periodically.
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      handleUpdate(reg)
      // Immediately check for updates (the browser may have a cached old SW)
      reg.update().then(() => handleUpdate(reg)).catch(() => {})
    }).catch(() => {})

    // Also listen for controller changes (when a new SW takes over)
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // The new SW has taken control — reload to ensure fresh assets.
      // Guard against double-reload.
      if (mounted && !reloading) {
        reloading = true
        window.location.reload()
      }
    })

    // Check for updates when the page becomes visible again (user returns
    // to the tab — common pattern for checking for new deployments)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg) {
            reg.update().then(() => handleUpdate(reg)).catch(() => {})
          }
        })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Also check periodically (every 5 minutes as a fallback)
    const interval = setInterval(async () => {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null)
      if (reg) {
        await reg.update().catch(() => {})
        handleUpdate(reg)
      }
    }, 5 * 60 * 1000)

    return () => {
      mounted = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const applyUpdate = () => {
    if (registration?.waiting) {
      // Tell the waiting SW to skip waiting and activate immediately
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    } else {
      // No waiting SW — just reload
      window.location.reload()
    }
  }

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[200] flex justify-center px-4 pt-3 pointer-events-none"
        >
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-2xl glass-dark shadow-xl max-w-md w-full">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
              <RefreshCw className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">Update available</div>
              <div className="text-xs text-muted-foreground">A new version of Adoo is ready.</div>
            </div>
            <Button
              size="sm"
              onClick={applyUpdate}
              className="shrink-0 gradient-primary text-primary-foreground hover:opacity-90"
            >
              Update
            </Button>
            <button
              onClick={() => setUpdateAvailable(false)}
              className="shrink-0 p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
