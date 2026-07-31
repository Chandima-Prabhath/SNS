'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Home, Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center overflow-hidden relative" style={{ background: 'oklch(0.15 0.005 264)' }}>
      {/* Mesh gradient backdrop — matches the app's login/landing page */}
      <div className="absolute inset-0 opacity-40" style={{
        background: `
          radial-gradient(ellipse at 20% 30%, oklch(0.62 0.21 264 / 0.15) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, oklch(0.65 0.24 330 / 0.1) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, oklch(0.58 0.2 280 / 0.08) 0%, transparent 60%)
        `,
      }} />

      {/* Animated orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
        style={{ background: 'oklch(0.62 0.21 264 / 0.08)' }}
        animate={{ x: [0, 50, 0], y: [0, -30, 0], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl"
        style={{ background: 'oklch(0.65 0.24 330 / 0.06)' }}
        animate={{ x: [0, -40, 0], y: [0, 40, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />

      <div className="relative z-10 text-center px-6 max-w-md">
        {/* 404 — large, gradient text matching app branding */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <h1 className="text-8xl font-black tracking-tighter" style={{
            background: 'linear-gradient(135deg, oklch(0.62 0.21 264), oklch(0.65 0.24 330), oklch(0.7 0.2 20))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            404
          </h1>
        </motion.div>

        {/* Icon */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="flex justify-center mb-6"
        >
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{
            background: 'oklch(0.62 0.21 264 / 0.1)',
            border: '1px solid oklch(0.62 0.21 264 / 0.2)',
          }}>
            <Compass className="w-8 h-8" style={{ color: 'oklch(0.62 0.21 264)' }} />
          </div>
        </motion.div>

        {/* Title + description */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="space-y-2 mb-8"
        >
          <h2 className="text-2xl font-bold" style={{ color: 'oklch(0.95 0 0)' }}>Lost in the void</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'oklch(0.6 0 0)' }}>
            The page you're looking for has drifted into the digital abyss.
            Let's get you back to familiar territory.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold hover:scale-105 active:scale-95 transition-transform shadow-lg"
            style={{
              background: 'oklch(0.62 0.21 264)',
              color: 'white',
              boxShadow: '0 8px 32px oklch(0.62 0.21 264 / 0.2)',
            }}
          >
            <Home className="w-4 h-4" />
            Back to Adoo
          </Link>
        </motion.div>

        {/* Floating particles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full"
            style={{
              left: `${20 + i * 12}%`,
              top: `${30 + (i % 3) * 20}%`,
              background: 'oklch(0.62 0.21 264 / 0.3)',
            }}
            animate={{ y: [0, -20, 0], opacity: [0.2, 0.6, 0.2] }}
            transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
          />
        ))}
      </div>
    </div>
  )
}
