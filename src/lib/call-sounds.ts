/**
 * Call sound effects — Web Audio API synthesis.
 * No audio files needed. Tiny, instant, sample-accurate.
 *
 * Sounds:
 *   - Ringback: US ringback tone (440+480Hz, 2s on / 4s off) — what the CALLER hears
 *   - Incoming: European ring tone (440Hz, 1s on / 3s off) — what the RECEIVER hears
 *   - Connected: short double-beep — call connected
 *   - Ended: low descending tone — call ended
 *   - Message: subtle pop — new message notification
 *
 * Usage:
 *   import { CallSounds } from '@/lib/call-sounds'
 *   CallSounds.unlock()                    // call on first user gesture
 *   CallSounds.startRingback()             // caller hears this while waiting
 *   CallSounds.startIncoming()             // receiver hears this
 *   CallSounds.stop()                      // stop any playing sound
 *   CallSounds.playConnected()             // call connected beep
 *   CallSounds.playEnded()                 // call ended tone
 *   CallSounds.playMessage()               // message notification pop
 */

let ctx: AudioContext | null = null
let activeNodes: { stop: () => void } | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

export const CallSounds = {
  /** Unlock audio — call on first user gesture (click, touch, keypress) */
  unlock() {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') c.resume()
  },

  /** Stop any currently playing sound */
  stop() {
    if (activeNodes) {
      activeNodes.stop()
      activeNodes = null
    }
  },

  /**
   * Ringback tone — what the CALLER hears while waiting for answer.
   * US cadence: 440+480Hz, 2s on, 4s off.
   */
  startRingback() {
    const c = getCtx()
    if (!c) return
    this.stop()
    if (c.state === 'suspended') c.resume()

    const o1 = c.createOscillator()
    o1.frequency.value = 440
    o1.type = 'sine'
    const o2 = c.createOscillator()
    o2.frequency.value = 480
    o2.type = 'sine'
    const g = c.createGain()
    g.gain.value = 0
    o1.connect(g)
    o2.connect(g)
    g.connect(c.destination)
    o1.start()
    o2.start()

    const now = c.currentTime
    g.gain.setValueAtTime(0.12, now)
    g.gain.setValueAtTime(0, now + 2)

    const interval = setInterval(() => {
      const t = c.currentTime
      g.gain.setValueAtTime(0.12, t)
      g.gain.setValueAtTime(0, t + 2)
    }, 6000)

    activeNodes = {
      stop: () => {
        clearInterval(interval)
        try {
          g.gain.cancelScheduledValues(c.currentTime)
          g.gain.setValueAtTime(0, c.currentTime)
          o1.stop()
          o2.stop()
        } catch {}
      },
    }
  },

  /**
   * Incoming ring — what the RECEIVER hears when getting a call.
   * European cadence: 440Hz, 1s on, 3s off. Higher pitch for urgency.
   */
  startIncoming() {
    const c = getCtx()
    if (!c) return
    this.stop()
    if (c.state === 'suspended') c.resume()

    const o = c.createOscillator()
    o.frequency.value = 480
    o.type = 'sine'
    const g = c.createGain()
    g.gain.value = 0
    o.connect(g)
    g.connect(c.destination)
    o.start()

    const now = c.currentTime
    g.gain.setValueAtTime(0.15, now)
    g.gain.setValueAtTime(0, now + 1)

    const interval = setInterval(() => {
      const t = c.currentTime
      g.gain.setValueAtTime(0.15, t)
      g.gain.setValueAtTime(0, t + 1)
    }, 4000)

    activeNodes = {
      stop: () => {
        clearInterval(interval)
        try {
          g.gain.cancelScheduledValues(c.currentTime)
          g.gain.setValueAtTime(0, c.currentTime)
          o.stop()
        } catch {}
      },
    }
  },

  /** Connected — quick double beep */
  playConnected() {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') c.resume()

    const now = c.currentTime
    const beep = (start: number, freq: number, dur: number) => {
      const o = c.createOscillator()
      o.frequency.value = freq
      o.type = 'sine'
      const g = c.createGain()
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(0.15, start + 0.01)
      g.gain.setValueAtTime(0.15, start + dur - 0.02)
      g.gain.linearRampToValueAtTime(0, start + dur)
      o.connect(g)
      g.connect(c.destination)
      o.start(start)
      o.stop(start + dur)
    }
    beep(now, 660, 0.1)
    beep(now + 0.12, 880, 0.15)
  },

  /** Ended — low descending tone */
  playEnded() {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') c.resume()

    const now = c.currentTime
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(440, now)
    o.frequency.exponentialRampToValueAtTime(220, now + 0.4)
    const g = c.createGain()
    g.gain.setValueAtTime(0.12, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    o.connect(g)
    g.connect(c.destination)
    o.start(now)
    o.stop(now + 0.5)
  },

  /** Message notification — subtle pop */
  playMessage() {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') c.resume()

    const now = c.currentTime
    const o = c.createOscillator()
    o.frequency.setValueAtTime(880, now)
    o.frequency.exponentialRampToValueAtTime(660, now + 0.08)
    o.type = 'sine'
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.06, now + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    o.connect(g)
    g.connect(c.destination)
    o.start(now)
    o.stop(now + 0.2)
  },
}
