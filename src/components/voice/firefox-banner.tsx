'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * Shows a banner recommending Chrome for Android users on Firefox.
 * Firefox Android has known WebRTC issues (getUserMedia, audio routing).
 */
export function FirefoxBanner() {
  const [dismissed, setDismissed] = useState(false)

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isFirefox = /Firefox/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const show = isFirefox && isAndroid && !dismissed

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-yellow-500/95 text-black text-sm px-4 py-2 flex items-center gap-2 pt-safe">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        For best call quality on Android, use Chrome. Firefox has known audio/video issues.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 hover:bg-black/10 rounded"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
