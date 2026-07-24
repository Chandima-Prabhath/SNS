'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * Fetches unread message counts per channel. Refetches every 10s as a fallback,
 * but primarily updated via the notifications hook invalidating the cache.
 */
export function useUnreadCounts() {
  return useQuery({
    queryKey: ['unread-counts'],
    queryFn: async () => {
      const res = await fetch('/api/unread')
      if (!res.ok) return { unread: {}, total: 0 }
      return res.json() as Promise<{ unread: Record<string, number>; total: number }>
    },
    refetchInterval: 10000,
  })
}
