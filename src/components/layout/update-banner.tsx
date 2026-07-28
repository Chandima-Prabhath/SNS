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
 *   1. On mount, we register the service worker (if not already registered).
 *   2. We listen for the 'controllerchange' event on navigator.serviceWorker.
 *   3. We periodically check for updates by calling registration.update().
 *   4. When a new SW is waiting, we show the banner.
 *   5. On "Update" click, we post a SKIP_WAITING message to the waiting SW
 *      and reload the page once the new SW takes control.
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
            setUpdateAvailable(true)
            setRegistration(reg)
          }
        })
      })
    }

    // Register or get existing registration
    navigator.serviceWorker.register('/sw.js').then(handleUpdate).catch(() => {})

    // Also listen for controller changes (when a new SW takes over)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // The new SW has taken control — reload to ensure fresh assets
      if (mounted) window.location.reload()
    })

    // Periodically check for updates every 10 minutes
    const interval = setInterval(async () => {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) {
        await reg.update().catch(() => {})
        handleUpdate(reg)
      }
    }, 10 * 60 * 1000)

    return () => {
      mounted = false
      clearInterval(interval)
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
