'use client'

import { useRef, type ReactNode, type CSSProperties } from 'react'

// ─── SpotlightCard ─────────────────────────────────────────────────────────
// Pure CSS. Cursor-following spotlight gradient on a card.
// From reactbits.dev /components/spotlight-card

export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(99, 102, 241, 0.15)',
  ...props
}: {
  children: ReactNode
  className?: string
  spotlightColor?: string
} & React.HTMLAttributes<HTMLDivElement>) {
  const divRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = divRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    divRef.current?.style.setProperty('--mx', `${x}px`)
    divRef.current?.style.setProperty('--my', `${y}px`)
  }

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      className={`group/spotlight relative overflow-hidden rounded-2xl border border-border/50 bg-card ${className}`}
      style={
        {
          '--spotlight-color': spotlightColor,
        } as CSSProperties
      }
      {...props}
    >
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-500 group-hover/spotlight:opacity-100"
        style={{
          background: `radial-gradient(350px circle at var(--mx) var(--my), var(--spotlight-color), transparent 80%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}

// ─── GlassSurface ──────────────────────────────────────────────────────────
// Pure CSS. Apple-style frosted glass container.
// From reactbits.dev /components/glass-surface

export function GlassSurface({
  children,
  className = '',
  blur = 20,
  opacity = 0.1,
}: {
  children: ReactNode
  className?: string
  blur?: number
  opacity?: number
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        background: `rgba(255, 255, 255, ${opacity})`,
        backdropFilter: `blur(${blur}px) saturate(180%)`,
        WebkitBackdropFilter: `blur(${blur}px) saturate(180%)`,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 32px rgba(0, 0, 0, 0.3)',
      }}
    >
      {children}
    </div>
  )
}

// ─── BorderGlow ────────────────────────────────────────────────────────────
// Pure CSS. Glowing mesh-gradient border.
// From reactbits.dev /components/border-glow

export function BorderGlow({
  children,
  className = '',
  glowColor = 'oklch(0.66 0.24 264)',
}: {
  children: ReactNode
  className?: string
  glowColor?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <div
        className="absolute -inset-px rounded-2xl opacity-60 blur-sm transition-opacity duration-500"
        style={{
          background: `linear-gradient(135deg, ${glowColor}, transparent 50%, ${glowColor})`,
        }}
      />
      <div className="relative rounded-2xl border border-border/50 bg-card overflow-hidden">
        {children}
      </div>
    </div>
  )
}

// ─── GradientText ──────────────────────────────────────────────────────────
// Pure CSS. Animated gradient sweep on text.
// From reactbits.dev /text-animations/gradient-text (simplified, no motion dep)

export function GradientText({
  children,
  className = '',
  colors = ['#6366f1', '#8b5cf6', '#ec4899', '#6366f1'],
  animationSpeed = 4,
}: {
  children: ReactNode
  className?: string
  colors?: string[]
  animationSpeed?: number
}) {
  const gradient = colors.join(', ')
  return (
    <span
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${gradient})`,
        backgroundSize: '200% auto',
        animation: `gradient-sweep ${animationSpeed}s linear infinite`,
      }}
    >
      <style>{`
        @keyframes gradient-sweep {
          to { background-position: 200% center; }
        }
      `}</style>
      {children}
    </span>
  )
}

// ─── ShinyText ─────────────────────────────────────────────────────────────
// Pure CSS. Metallic sheen sweep on text.
// From reactbits.dev /text-animations/shiny-text (simplified, no motion dep)

export function ShinyText({
  children,
  className = '',
  shimmerDuration = 3,
}: {
  children: ReactNode
  className?: string
  shimmerDuration?: number
}) {
  return (
    <span
      className={`inline-block ${className}`}
      style={{
        backgroundImage: 'linear-gradient(110deg, oklch(0.45 0.01 250) 35%, oklch(0.95 0.004 250) 50%, oklch(0.45 0.01 250) 65%)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        animation: `shiny-sweep ${shimmerDuration}s linear infinite`,
      }}
    >
      <style>{`
        @keyframes shiny-sweep {
          to { background-position: -200% center; }
        }
      `}</style>
      {children}
    </span>
  )
}

// ─── StarBorder ────────────────────────────────────────────────────────────
// Pure CSS. Animated sparkle border.
// From reactbits.dev /animations/star-border

export function StarBorder({
  children,
  className = '',
  color = 'oklch(0.66 0.24 264)',
}: {
  children: ReactNode
  className?: string
  color?: string
}) {
  return (
    <div className={`relative inline-flex overflow-hidden rounded-2xl ${className}`}>
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          padding: '1px',
          background: `conic-gradient(from 0deg, transparent, ${color}, transparent 30%)`,
          animation: 'star-rotate 3s linear infinite',
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />
      <style>{`
        @keyframes star-rotate {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div className="relative z-10">{children}</div>
    </div>
  )
}
