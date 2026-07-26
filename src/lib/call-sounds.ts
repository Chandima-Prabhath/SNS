/**
 * Call sound effects — Web Audio API synthesis.
 *
 * Mobile fixes:
 *   - Uses upfront scheduled automation (not setInterval) — sample-accurate,
 *     immune to background timer throttling
 *   - Proper cleanup: cancelScheduledValues + disconnect all nodes
 *   - Generation counter so stale stop() can't clobber newer sounds
 *   - visibilitychange listener resumes suspended AudioContext
 *   - stop() called directly from call-manager (not just React events)
 */

let ctx: AudioContext | null = null
let activeStop: (() => void) | null = null
let generation = 0

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    // Resume on visibility change (mobile suspends when backgrounded)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && ctx?.state === 'suspended') {
        ctx.resume()
      }
    })
  }
  return ctx
}

export const CallSounds = {
  unlock() {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') c.resume()
  },

  stop() {
    if (activeStop) {
      activeStop()
      activeStop = null
    }
  },

  /**
   * Ringback tone — what the CALLER hears while waiting.
   * US cadence: 440+480Hz, 2s on, 4s off.
   * Uses scheduled automation (not setInterval) for mobile reliability.
   */
  startRingback() {
    const c = getCtx()
    if (!c) return
    this.stop()
    if (c.state === 'suspended') c.resume()

    const myGen = ++generation
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

    // Schedule 10 minutes of ringback (2s on, 4s off, 6s cycle)
    const ON = 2
    const CYCLE = 6
    const now = c.currentTime
    for (let i = 0; i < 100; i++) {
      const t = now + i * CYCLE
      g.gain.setValueAtTime(0.12, t)
      g.gain.setValueAtTime(0.0, t + ON)
    }

    activeStop = () => {
      if (myGen !== generation) return // stale, ignore
      try {
        g.gain.cancelScheduledValues(c.currentTime)
        g.gain.setValueAtTime(0, c.currentTime)
        o1.stop()
        o2.stop()
        o1.disconnect()
        o2.disconnect()
        g.disconnect()
      } catch {}
    }
  },

  /**
   * Incoming ring — what the RECEIVER hears.
   * 480Hz, 1s on, 3s off.
   */
  startIncoming() {
    const c = getCtx()
    if (!c) return
    this.stop()
    if (c.state === 'suspended') c.resume()

    const myGen = ++generation
    const o = c.createOscillator()
    o.frequency.value = 480
    o.type = 'sine'
    const g = c.createGain()
    g.gain.value = 0
    o.connect(g)
    g.connect(c.destination)
    o.start()

    // Schedule 10 minutes of incoming ring (1s on, 3s off, 4s cycle)
    const ON = 1
    const CYCLE = 4
    const now = c.currentTime
    for (let i = 0; i < 150; i++) {
      const t = now + i * CYCLE
      g.gain.setValueAtTime(0.15, t)
      g.gain.setValueAtTime(0.0, t + ON)
    }

    activeStop = () => {
      if (myGen !== generation) return
      try {
        g.gain.cancelScheduledValues(c.currentTime)
        g.gain.setValueAtTime(0, c.currentTime)
        o.stop()
        o.disconnect()
        g.disconnect()
      } catch {}
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
