'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Home, AlertTriangle, RefreshCw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app-error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative" style={{ background: 'oklch(0.15 0.005 264)' }}>
      {/* Mesh gradient backdrop */}
      <div className="absolute inset-0 opacity-40" style={{
        background: `
          radial-gradient(ellipse at 20% 30%, oklch(0.64 0.21 25 / 0.1) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, oklch(0.7 0.2 40 / 0.08) 0%, transparent 50%)
        `,
      }} />

      {/* Animated orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
        style={{ background: 'oklch(0.64 0.21 25 / 0.06)' }}
        animate={{ x: [0, 50, 0], y: [0, -30, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl"
        style={{ background: 'oklch(0.7 0.2 40 / 0.04)' }}
        animate={{ x: [0, -40, 0], y: [0, 40, 0], opacity: [0.15, 0.3, 0.15] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />

      <div className="relative z-10 text-center px-6 max-w-md">
        {/* Error icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex justify-center mb-6"
        >
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
            background: 'oklch(0.64 0.21 25 / 0.1)',
            border: '1px solid oklch(0.64 0.21 25 / 0.2)',
          }}>
            <AlertTriangle className="w-8 h-8" style={{ color: 'oklch(0.7 0.2 25)' }} />
          </div>
        </motion.div>

        {/* Title + description */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="space-y-2 mb-8"
        >
          <h1 className="text-3xl font-black tracking-tight" style={{
            background: 'linear-gradient(135deg, oklch(0.64 0.21 25), oklch(0.7 0.2 40))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Something broke
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'oklch(0.6 0 0)' }}>
            An unexpected error occurred. Don't worry — your data is safe.
            Try again, or head back home.
          </p>
          {error?.message && (
            <p className="text-xs font-mono mt-3 px-4 py-2 rounded-lg" style={{
              color: 'oklch(0.7 0.2 25 / 0.6)',
              background: 'oklch(0.64 0.21 25 / 0.05)',
              border: '1px solid oklch(0.64 0.21 25 / 0.1)',
            }}>
              {error.message.slice(0, 120)}
            </p>
          )}
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="flex items-center justify-center gap-3"
        >
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold hover:scale-105 active:scale-95 transition-transform shadow-lg"
            style={{
              background: 'oklch(0.62 0.21 264)',
              color: 'white',
              boxShadow: '0 8px 32px oklch(0.62 0.21 264 / 0.2)',
            }}
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
            style={{
              background: 'oklch(1 0 0 / 0.05)',
              border: '1px solid oklch(1 0 0 / 0.1)',
              color: 'oklch(0.9 0 0)',
            }}
          >
            <Home className="w-4 h-4" />
            Home
          </Link>
        </motion.div>
      </div>
    </div>
  )
}
