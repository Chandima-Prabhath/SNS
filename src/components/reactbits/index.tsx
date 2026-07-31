'use client'

import { useRef, useEffect, useState, type ReactNode, type CSSProperties } from 'react'

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

// ─── TiltedCard ─────────────────────────────────────────────────────────────
// 3D perspective tilt that follows the cursor. From reactbits.dev /components/tilted-card
// Adapted for our dark theme. Used for cinematic movie posters.

export function TiltedCard({
  children,
  className = '',
  rotateAmplitude = 12,
  scaleOnHover = 1.05,
  showSpotlight = true,
  spotlightColor = 'rgba(99, 102, 241, 0.25)',
}: {
  children: ReactNode
  className?: string
  rotateAmplitude?: number
  scaleOnHover?: number
  showSpotlight?: boolean
  spotlightColor?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2
    const rx = ((y - cy) / cy) * -rotateAmplitude
    const ry = ((x - cx) / cx) * rotateAmplitude
    el.style.setProperty('--rx', `${rx}deg`)
    el.style.setProperty('--ry', `${ry}deg`)
    el.style.setProperty('--mx', `${x}px`)
    el.style.setProperty('--my', `${y}px`)
  }

  const handleLeave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    setIsHovering(false)
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleLeave}
      className={`relative [perspective:1000px] ${className}`}
      style={
        {
          '--spotlight-color': spotlightColor,
        } as CSSProperties
      }
    >
      <div
        className="relative [transform-style:preserve-3d] transition-transform duration-200 ease-out"
        style={{
          transform: `rotateX(var(--rx, 0)) rotateY(var(--ry, 0)) scale(${isHovering ? scaleOnHover : 1})`,
        }}
      >
        {showSpotlight && (
          <div
            className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] opacity-0 transition-opacity duration-300"
            style={{
              opacity: isHovering ? 1 : 0,
              background: `radial-gradient(circle at var(--mx) var(--my), var(--spotlight-color), transparent 60%)`,
            }}
          />
        )}
        {children}
      </div>
    </div>
  )
}

// ─── Meteors ───────────────────────────────────────────────────────────────
// Animated meteor shower. From reactbits.dev /components/meteors
// Pure CSS animation — no canvas needed. Used as cinematic background.

export function Meteors({
  count = 18,
  className = '',
}: {
  count?: number
  className?: string
}) {
  const [meteors, setMeteors] = useState<number[]>([])

  useEffect(() => {
    setMeteors(Array.from({ length: count }, (_, i) => i))
  }, [count])

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <style>{`
        @keyframes meteor-fall {
          0% {
            transform: translate(0, 0) rotate(215deg);
            opacity: 1;
          }
          70% { opacity: 1; }
          100% {
            transform: translate(-500px, 500px) rotate(215deg);
            opacity: 0;
          }
        }
      `}</style>
      {meteors.map((i) => {
        const left = Math.random() * 100
        const delay = Math.random() * 6
        const duration = 4 + Math.random() * 4
        const size = 1 + Math.random() * 1.5
        return (
          <span
            key={i}
            className="absolute top-0"
            style={{
              left: `${left}%`,
              animation: `meteor-fall ${duration}s linear ${delay}s infinite`,
            }}
          >
            <span
              className="block rounded-full bg-white"
              style={{
                width: `${size * 80}px`,
                height: `${size}px`,
                background: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(99,102,241,0.4) 40%, transparent)',
                boxShadow: '0 0 8px rgba(255,255,255,0.5)',
              }}
            />
          </span>
        )
      })}
    </div>
  )
}

// ─── AnimatedGradientText ───────────────────────────────────────────────────
// Multi-stop animated gradient text with shifting hues.
// From reactbits.dev /text-animations/animated-gradient-text

export function AnimatedGradientText({
  children,
  className = '',
  colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#6366f1'],
  animationSpeed = 6,
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
        backgroundSize: '250% 100%',
        animation: `animated-gradient-shift ${animationSpeed}s linear infinite`,
      }}
    >
      <style>{`
        @keyframes animated-gradient-shift {
          0% { background-position: 0% 50%; }
          100% { background-position: 250% 50%; }
        }
      `}</style>
      {children}
    </span>
  )
}

// ─── Counter ───────────────────────────────────────────────────────────────
// Animated number counter that counts up when in view.
// From reactbits.dev /components/counter

export function Counter({
  value,
  duration = 1.5,
  decimals = 0,
  className = '',
  suffix = '',
  prefix = '',
}: {
  value: number
  duration?: number
  decimals?: number
  className?: string
  suffix?: string
  prefix?: string
}) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true
            const start = performance.now()
            const animate = (now: number) => {
              const elapsed = (now - start) / 1000
              const progress = Math.min(elapsed / duration, 1)
              const eased = 1 - Math.pow(1 - progress, 3)
              setDisplay(value * eased)
              if (progress < 1) requestAnimationFrame(animate)
              else setDisplay(value)
            }
            requestAnimationFrame(animate)
          }
        })
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [value, duration])

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}

// ─── ShimmerLine ────────────────────────────────────────────────────────────
// Horizontal shimmering line — for loading states under hero / above rows.

export function ShimmerLine({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-full bg-white/5 ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
          backgroundSize: '200% 100%',
          animation: 'shimmer-line 1.8s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes shimmer-line {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  )
}

// ─── PulseBeam ──────────────────────────────────────────────────────────────
// Pulsing gradient beam — for "LIVE" / "Now Playing" indicators.

export function PulseBeam({
  className = '',
  color = 'oklch(0.68 0.24 264)',
}: {
  className?: string
  color?: string
}) {
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`}>
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
        style={{ background: color }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </span>
  )
}

