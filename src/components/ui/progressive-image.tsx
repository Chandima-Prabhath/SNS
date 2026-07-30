'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ProgressiveImageProps {
  src: string
  alt?: string
  className?: string
  width?: number
  /** Tiny preview width (loaded first for instant blur-up effect) */
  previewWidth?: number
}

/**
 * Progressive image — loads a tiny blurred version first, then the full image.
 * Uses the /api/img endpoint for server-side resizing via sharp.
 *
 * Flow:
 *   1. Show a 40px wide, low-quality version (loads in ~50ms)
 *   2. Load the full version in the background
 *   3. Crossfade from blurry to sharp when the full version loads
 */
export function ProgressiveImage({
  src,
  alt = '',
  className,
  width = 800,
  previewWidth = 40,
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  // Only optimize uploaded images (not external URLs or SVGs)
  // Both /uploads/ (legacy) and /api/uploads/ (new) are optimizable.
  const isOptimizable = src.startsWith('/uploads/') || src.startsWith('/api/uploads/')
  const previewSrc = isOptimizable
    ? `/api/img?src=${encodeURIComponent(src)}&w=${previewWidth}&q=30`
    : src
  const fullSrc = isOptimizable
    ? `/api/img?src=${encodeURIComponent(src)}&w=${width}&q=75`
    : src

  // Use key={src} on the component to reset state when src changes
  // instead of using useEffect with setState

  if (error) {
    return (
      <div className={cn('bg-muted flex items-center justify-center', className)}>
        <span className="text-xs text-muted-foreground">Failed to load</span>
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Blurry preview */}
      <img
        src={previewSrc}
        alt={alt}
        className={cn(
          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-0' : 'opacity-100 blur-xl scale-110'
        )}
        onError={() => setError(true)}
      />
      {/* Full quality */}
      <img
        src={fullSrc}
        alt={alt}
        className={cn(
          'relative w-full h-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
    </div>
  )
}
