'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Music, Clapperboard, X, Sparkles, Film } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { GradientText, GlassSurface, BorderGlow } from '@/components/reactbits'

/**
 * EntertainmentDrawer
 *
 * A bottom-sheet (mobile) / centered popover (desktop) that opens when the user
 * taps the "Entertainment" item in the nav. Holds two big shortcuts:
 *   - Music   → useAppStore.setView('music')
 *   - Cinema  → useAppStore.setView('cinema')
 *
 * Both shortcuts also close the drawer.
 */
export function EntertainmentDrawer() {
  const open = useAppStore((s) => s.entertainmentDrawerOpen)
  const setOpen = useAppStore((s) => s.setEntertainmentDrawerOpen)
  const setView = useAppStore((s) => s.setView)

  const handleSelect = (view: 'music' | 'cinema') => {
    setView(view)
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Drawer — bottom sheet on mobile, centered popover on desktop */}
          <motion.div
            initial={{ y: '100%', opacity: 0.5, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: '100%', opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-50 md:inset-0 md:flex md:items-center md:justify-center md:pointer-events-none"
          >
            <div className="md:pointer-events-auto">
              <GlassSurface
                blur={32}
                opacity={0.08}
                className="rounded-t-3xl md:rounded-3xl p-5 md:p-6 w-full md:w-[440px] max-h-[85vh] overflow-y-auto"
              >
                {/* Mobile grab handle */}
                <div className="md:hidden flex justify-center mb-4">
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-black tracking-tight">
                      <GradientText>Entertainment</GradientText>
                    </h2>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="p-2 rounded-xl hover:bg-white/10 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                  Pick what you're in the mood for. Your library, queue, and history stay in sync.
                </p>

                {/* Two big shortcut cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <EntertainmentCard
                    title="Music"
                    subtitle="Stream, queue, vibe"
                    icon={<Music className="w-7 h-7" />}
                    gradient="from-indigo-500/30 via-purple-500/20 to-fuchsia-500/30"
                    accent="oklch(0.68 0.24 264)"
                    onClick={() => handleSelect('music')}
                  />
                  <EntertainmentCard
                    title="Cinema"
                    subtitle="Movies & TV shows"
                    icon={<Clapperboard className="w-7 h-7" />}
                    gradient="from-rose-500/30 via-orange-500/20 to-amber-500/30"
                    accent="oklch(0.70 0.22 25)"
                    onClick={() => handleSelect('cinema')}
                  />
                </div>

                {/* Footer hint */}
                <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                  <Film className="w-3 h-3" />
                  Tip: switch between them anytime from this drawer.
                </div>
              </GlassSurface>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function EntertainmentCard({
  title,
  subtitle,
  icon,
  gradient,
  accent,
  onClick,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  gradient: string
  accent: string
  onClick: () => void
}) {
  return (
    <BorderGlow glowColor={accent} className="rounded-2xl">
      <button
        onClick={onClick}
        className={`w-full text-left p-5 rounded-2xl bg-gradient-to-br ${gradient} hover:scale-[1.03] active:scale-[0.98] transition-transform group/card`}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 ring-1 ring-white/10 group-hover/card:ring-white/20 transition-all"
          style={{
            background: `${accent.replace(')', ' / 0.2)')}`,
            boxShadow: `0 0 20px ${accent.replace(')', ' / 0.4)')}`,
            color: accent,
          }}
        >
          {icon}
        </div>
        <div className="text-base font-bold tracking-tight">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </button>
    </BorderGlow>
  )
}
