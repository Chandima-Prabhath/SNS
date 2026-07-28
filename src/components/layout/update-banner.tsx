'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * UpdateBanner — shows a notification when a new app build is deployed.
 *
 * Two detection mechanisms:
 *   1. Service Worker update detection (for SW/asset cache changes)
 *   2. Version polling (for ALL other changes — components, API routes, etc.)
 *
 * The version polling checks /api/version every 60 seconds. The endpoint
 * returns the Next.js BUILD_ID which changes on every `next build`. If the
 * BUILD_ID differs from the one seen on page load, we show the banner.
 *
 * This catches ALL updates — not just SW changes.
 */
export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const initialBuildIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    let mounted = true

    // ── Mechanism 1: Service Worker update detection ──────────────────
    const handleUpdate = (reg: ServiceWorkerRegistration) => {
      if (!mounted) return
      if (reg.waiting) {
        console.log('[update-banner] SW waiting detected')
        setUpdateAvailable(true)
        setRegistration(reg)
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[update-banner] new SW installed')
            setUpdateAvailable(true)
            setRegistration(reg)
          }
        })
      })
    }

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      handleUpdate(reg)
      reg.update().then(() => handleUpdate(reg)).catch(() => {})
    }).catch(() => {})

    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (mounted && !reloading) {
        reloading = true
        window.location.reload()
      }
    })

    // ── Mechanism 2: Version polling (catches ALL updates) ────────────
    // Fetch the initial build ID on page load
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        initialBuildIdRef.current = data.buildId
        console.log('[update-banner] initial build ID:', data.buildId)
      })
      .catch(() => {})

    // Poll every 60 seconds for a new build
    const versionInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()

        // If we have an initial build ID and it's different now, update!
        if (
          initialBuildIdRef.current &&
          data.buildId &&
          data.buildId !== initialBuildIdRef.current
        ) {
          console.log('[update-banner] build ID changed:', initialBuildIdRef.current, '→', data.buildId)
          setUpdateAvailable(true)
          // No SW registration to message — just reload
          setRegistration(null)
        }
      } catch {
        // Network error — ignore
      }
    }, 60 * 1000) // every 60 seconds

    // Also check when the tab becomes visible
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check SW
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg) {
            reg.update().then(() => handleUpdate(reg)).catch(() => {})
          }
        })
        // Check version
        fetch('/api/version', { cache: 'no-store' })
          .then((r) => r.json())
          .then((data) => {
            if (
              initialBuildIdRef.current &&
              data.buildId &&
              data.buildId !== initialBuildIdRef.current
            ) {
              console.log('[update-banner] build ID changed (visibility):', data.buildId)
              setUpdateAvailable(true)
              setRegistration(null)
            }
          })
          .catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      mounted = false
      clearInterval(versionInterval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const applyUpdate = () => {
    if (registration?.waiting) {
      // SW update — tell it to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    } else {
      // Version update (no SW change) — just reload the page
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
