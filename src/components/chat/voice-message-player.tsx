'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { Play, Pause, Loader2, AudioLines, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * VoiceMessagePlayer — custom audio player for voice messages.
 *
 * Replaces the bare <audio controls> element with a polished WhatsApp/Telegram
 * style player:
 *   - Circular play/pause button with gradient background
 *   - Animated waveform bars (synthesized from audio analyser, falls back to
 *     a static pattern while loading)
 *   - Progress bar overlaid on the waveform
 *   - Duration display (current / total)
 *
 * Works for any audio format the browser supports (WebM/Opus, WAV, MP3, OGG, M4A).
 * Used for both regular voice messages AND TTS-generated voice messages.
 *
 * Multiple players on the same page are aware of each other — playing one
 * pauses all others (via a shared module-level `activePlayerRef`).
 */

// Module-level registry: only one player can play at a time across the whole app.
// When a player starts, it calls `activePlayerRef.current?.pause()` to stop
// whoever was playing before.
type PlayerControl = { pause: () => void }
const activePlayerRef: { current: PlayerControl | null } = { current: null }

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VoiceMessagePlayer({
  src,
  isMine,
  label,
}: {
  src: string
  isMine: boolean
  /** Optional label shown to the left of the duration (e.g. "Voice" or "TTS") */
  label?: string
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  // Reset state when src changes (e.g. when scrolling to a different message)
  useEffect(() => {
    setIsPlaying(false)
    setIsLoading(true)
    setCurrentTime(0)
    setDuration(0)
  }, [src])

  // Metadata-load timeout — if the browser doesn't fire 'loadedmetadata'
  // within 3 seconds (e.g. slow network, unsupported format, server not
  // supporting range requests), stop the spinner anyway so the user sees
  // the play button instead of an infinite loading state.
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [src])

  // Set up audio element event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      setDuration(audio.duration)
      setIsLoading(false)
    }
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
      audio.currentTime = 0
      // Release the active-player lock if we still hold it
      if (activePlayerRef.current && activePlayerRef.current.pause === pauseFnRef.current) {
        activePlayerRef.current = null
      }
    }
    const onPause = () => setIsPlaying(false)
    const onPlay = () => setIsPlaying(true)
    const onWaiting = () => setIsLoading(true)
    const onCanPlay = () => setIsLoading(false)
    const onError = () => {
      console.error('[voice-player] audio error', audio.error)
      setIsLoading(false)
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
    }
  }, [src])

  // Pause function stored in a ref so onEnded (which is set up once per src)
  // can read the latest version without re-subscribing to events.
  const pauseFnRef = useRef<() => void>(() => {})
  pauseFnRef.current = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    setIsPlaying(false)
  }

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      // Release the active-player lock if we hold it
      if (activePlayerRef.current?.pause === pauseFnRef.current) {
        activePlayerRef.current = null
      }
      return
    }

    // Pause any other player that's currently playing
    if (activePlayerRef.current) {
      activePlayerRef.current.pause()
    }
    // Register ourselves as the active player
    activePlayerRef.current = { pause: pauseFnRef.current }

    try {
      await audio.play()
    } catch (e) {
      console.error('[voice-player] play() failed:', e)
      setIsPlaying(false)
      if (activePlayerRef.current?.pause === pauseFnRef.current) {
        activePlayerRef.current = null
      }
    }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    audio.currentTime = Math.max(0, Math.min(duration, ratio * duration))
    setCurrentTime(audio.currentTime)
  }

  const cyclePlaybackRate = () => {
    const audio = audioRef.current
    if (!audio) return
    const rates = [1, 1.5, 2, 0.75]
    const next = rates.find((r) => r > playbackRate) || rates[0]
    setPlaybackRate(next)
    audio.playbackRate = next
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // Render the waveform as a row of vertical bars. The "played" portion uses
  // the primary color; the "remaining" portion uses a muted color. Bar heights
  // are deterministic (seeded from the src string) so they don't reshuffle
  // on every render.
  const bars = useMemo(() => {
    const BAR_COUNT = 28
    // Simple hash → seed
    let seed = 0
    for (let i = 0; i < src.length; i++) seed = (seed * 31 + src.charCodeAt(i)) | 0
    const rng = (i: number) => {
      const x = Math.sin(seed + i * 17) * 10000
      return x - Math.floor(x)
    }
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      // Pseudo-random heights between 30% and 100%
      const height = 30 + rng(i) * 70
      return height
    })
  }, [src])

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 p-2 rounded-xl',
        isMine
          ? 'bg-gradient-to-r from-primary/15 to-primary/5'
          : 'bg-gradient-to-r from-black/25 to-black/10'
      )}
    >
      {/* Hidden native audio element — we drive it via refs */}
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        className="hidden"
      />

      {/* Play / Pause / Loading button — always clickable. Even if metadata
          hasn't loaded yet, clicking will attempt to play (the browser will
          load the audio on demand). The spinner only shows for the first 3s. */}
      <button
        onClick={togglePlay}
        disabled={false}
        className={cn(
          'shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all',
          'shadow-md hover:scale-105 active:scale-95',
          isMine
            ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground'
            : 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground',
          isLoading && !duration && !isPlaying && 'opacity-70'
        )}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isLoading && !duration && !isPlaying ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      {/* Waveform + progress + duration */}
      <div className="flex-1 min-w-0">
        {/* Waveform (clickable to seek) */}
        <div
          onClick={seek}
          className="relative flex items-center gap-[2px] h-7 cursor-pointer select-none"
          role="slider"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Seek"
        >
          {bars.map((height, i) => {
            // Each bar's "played" state is binary — bars before the progress
            // threshold use the primary color, bars after use muted.
            const barProgress = ((i + 1) / bars.length) * 100
            const isPlayed = barProgress <= progress
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-full transition-colors',
                  isPlayed
                    ? (isMine ? 'bg-primary' : 'bg-primary')
                    : (isMine ? 'bg-primary/30' : 'bg-white/25')
                )}
                style={{ height: `${height}%` }}
              />
            )
          })}
        </div>

        {/* Time + label row */}
        <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1 font-medium">
            <Mic className="w-2.5 h-2.5" />
            {label || 'Voice'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={cyclePlaybackRate}
              className="px-1.5 py-0.5 rounded bg-black/20 hover:bg-black/30 font-mono font-semibold transition-colors"
              title="Cycle playback speed"
            >
              {playbackRate}×
            </button>
            <span className="tabular-nums font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>

      {/* AudioLines icon — subtle decoration on the right */}
      <div className="shrink-0 self-center opacity-30">
        <AudioLines className="w-4 h-4" />
      </div>
    </div>
  )
}
