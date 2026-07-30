'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff } from 'lucide-react'

/**
 * useOnlineStatus — tracks whether the browser is online or offline.
 * Returns true when online, false when offline.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

/**
 * OfflineBanner — shows a small banner at the top when the network is down.
 * Informs the user they're in offline mode and can read cached data.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[150] flex justify-center pointer-events-none"
        >
          <div className="pointer-events-auto flex items-center gap-2 px-4 py-2 mt-2 rounded-full bg-amber-500/90 backdrop-blur-xl shadow-lg text-amber-950 text-xs font-medium">
            <WifiOff className="w-3.5 h-3.5" />
            You're offline — showing cached content
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
