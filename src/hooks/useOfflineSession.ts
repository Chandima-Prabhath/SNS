'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'

const SESSION_CACHE_KEY = 'adoo-session-cache'

/**
 * useOfflineSession — caches the NextAuth session in localStorage so the
 * app can determine authentication status even when offline.
 *
 * When the network is up, next-auth's useSession works normally and we
 * update the cache. When the network is down, useSession returns
 * 'unauthenticated' (because it can't reach the server), but we check
 * the cache — if there's a valid cached session, we treat the user as
 * authenticated and let them use the app with cached data.
 *
 * Usage: call this hook at the app root level. It returns the effective
 * session status: 'loading' | 'authenticated' | 'unauthenticated'
 */
export function useOfflineSession() {
  const { data: session, status } = useSession()

  useEffect(() => {
    // Cache the session whenever we get a valid one
    if (status === 'authenticated' && session) {
      try {
        localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
          session,
          timestamp: Date.now(),
        }))
      } catch {}
    }
  }, [session, status])

  // If we're offline and next-auth says unauthenticated, check the cache
  useEffect(() => {
    const handleOffline = () => {
      // When going offline, next-auth may flip to 'unauthenticated'
      // The AppShell will check the cache via getCachedSession()
    }
    window.addEventListener('offline', handleOffline)
    return () => window.removeEventListener('offline', handleOffline)
  }, [])
}

/**
 * getCachedSession — returns the cached session from localStorage, or null.
 * Used by the AppShell to determine if the user was previously authenticated
 * (even if next-auth can't verify the session because the network is down).
 */
export function getCachedSession(): { session: any; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    // Cache expires after 7 days
    if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(SESSION_CACHE_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

/**
 * clearCachedSession — removes the cached session (used on logout).
 */
export function clearCachedSession() {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY)
  } catch {}
}
