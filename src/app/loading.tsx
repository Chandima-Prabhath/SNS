'use client'

import { motion } from 'framer-motion'

/**
 * App-level loading screen — shown during initial app load and route transitions.
 * Cinematic: centered animated logo with gradient orb backdrop.
 * Uses explicit dark colors (renders outside ThemeProvider).
 */
export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative" style={{ background: 'oklch(0.15 0.005 264)' }}>
      {/* Gradient orbs */}
      <motion.div
        className="absolute top-1/3 left-1/3 w-72 h-72 rounded-full blur-3xl"
        style={{ background: 'oklch(0.62 0.21 264 / 0.1)' }}
        animate={{ opacity: [0.2, 0.4, 0.2], scale: [1, 1.1, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-1/3 right-1/3 w-64 h-64 rounded-full blur-3xl"
        style={{ background: 'oklch(0.65 0.24 330 / 0.08)' }}
        animate={{ opacity: [0.15, 0.3, 0.15], scale: [1, 1.15, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />

      {/* Logo pulse */}
      <div className="relative z-10 flex flex-col items-center gap-4">
        <motion.div
          animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="text-3xl font-black tracking-tighter"
          style={{
            background: 'linear-gradient(135deg, oklch(0.62 0.21 264), oklch(0.65 0.24 330), oklch(0.7 0.2 20))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Adoo
        </motion.div>
        <motion.div
          className="flex gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'oklch(0.62 0.21 264)' }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </motion.div>
      </div>
    </div>
  )
}
