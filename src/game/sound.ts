/**
 * Synthesized sound engine.
 *
 * There are no audio files anywhere in the project: every cue below is built at
 * runtime from oscillators plus one shared noise buffer, so nothing has to be
 * fetched or decoded and the bundle stays as small as it was.
 *
 * Autoplay policy: browsers refuse to start an AudioContext until the page has
 * been touched. A listener armed at module load drives `unlock()`, which is the
 * only place a context is ever created or resumed, and it always runs from a
 * real gesture (pointer, key or touch). Until then `play()` counts the cue and
 * returns, so nothing is scheduled silently.
 *
 * While `settings.sound` is off no context is created at all, so the whole
 * subsystem costs nothing until the player actually makes a noise.
 */

/** every cue the game can ask for; a union so a typo cannot ship unnoticed */
export type Cue = 'step' | 'stepRun' | 'spotted' | 'gunshot' | 'coin' | 'eat' | 'drink' | 'sleep'

interface ToneOptions {
  freq: number
  dur: number
  type?: OscillatorType
  gain?: number
  /** seconds from now */
  at?: number
  /** glide the pitch here across the cue's life */
  slideTo?: number
}

interface BurstOptions {
  dur: number
  gain?: number
  at?: number
  freq?: number
  q?: number
  type?: BiquadFilterType
}

class Sfx {
  private enabled = true
  /** set the first time the page is touched; gates all WebAudio work */
  private armed = false
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  /** cues requested since the last reset (dev telemetry, works without audio) */
  private fired = 0
  private last: Cue | null = null

  constructor() {
    if (typeof window === 'undefined') return
    const unlock = () => this.unlock()
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    window.addEventListener('touchstart', unlock, { passive: true })
  }

  /** honour `settings.sound`; off means no context is ever built */
  setEnabled(on: boolean) {
    this.enabled = on
  }

  isEnabled() {
    return this.enabled
  }

  /** how many cues were actually requested since the last reset */
  getFired() {
    return this.fired
  }

  /** the most recent cue asked for, or null — used by the dev self test */
  getLast() {
    return this.last
  }

  resetFired() {
    this.fired = 0
    this.last = null
  }

  /** create and resume the context. Only ever called from a user gesture. */
  unlock() {
    if (!this.enabled) return
    this.armed = true
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  play(cue: Cue) {
    if (!this.enabled) return
    this.fired++
    this.last = cue
    if (!this.armed) return
    const ctx = this.ensure()
    if (!ctx || !this.master) return
    if (ctx.state === 'suspended') void ctx.resume()
    switch (cue) {
      case 'step':
        this.step(false)
        break
      case 'stepRun':
        this.step(true)
        break
      case 'spotted':
        this.spotted()
        break
      case 'gunshot':
        this.gunshot()
        break
      case 'coin':
        this.coin()
        break
      case 'eat':
        this.eat()
        break
      case 'drink':
        this.drink()
        break
      case 'sleep':
        this.sleep()
        break
    }
  }

  /* ---------------------------------------------------------------- */
  /* plumbing                                                         */
  /* ---------------------------------------------------------------- */

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (typeof window === 'undefined') return null
    const w = window as unknown as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return null
    try {
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = 0.5
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      return ctx
    } catch {
      return null
    }
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.5))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    return buf
  }

  /** a pitched blip with a soft attack and an exponential tail */
  private tone(o: ToneOptions) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t0 = ctx.currentTime + (o.at ?? 0)
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.freq, t0)
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + o.dur)
    const g = ctx.createGain()
    const peak = o.gain ?? 0.2
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
    osc.connect(g).connect(master)
    osc.start(t0)
    osc.stop(t0 + o.dur + 0.02)
  }

  /** a filtered slice of the shared noise buffer */
  private burst(o: BurstOptions) {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t0 = ctx.currentTime + (o.at ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noise(ctx)
    const filt = ctx.createBiquadFilter()
    filt.type = o.type ?? 'lowpass'
    filt.frequency.value = o.freq ?? 900
    filt.Q.value = o.q ?? 1
    const g = ctx.createGain()
    const peak = o.gain ?? 0.2
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
    src.connect(filt).connect(g).connect(master)
    src.start(t0)
    src.stop(t0 + o.dur + 0.02)
  }

  /* ---------------------------------------------------------------- */
  /* cues                                                            */
  /* ---------------------------------------------------------------- */

  /** a soft pavement tap; running lands it harder and a touch brighter */
  private step(run: boolean) {
    const g = run ? 0.15 : 0.09
    this.burst({ dur: run ? 0.06 : 0.05, gain: g, freq: run ? 520 : 380, q: 0.8 })
    this.tone({ freq: run ? 120 : 95, dur: 0.07, type: 'sine', gain: g * 0.7, slideTo: 58 })
  }

  /** two rising notes: somebody just locked on to you */
  private spotted() {
    this.tone({ freq: 740, dur: 0.11, type: 'square', gain: 0.11 })
    this.tone({ freq: 1180, dur: 0.18, type: 'square', gain: 0.11, at: 0.1 })
  }

  /** crack, hiss and a low thump */
  private gunshot() {
    this.burst({ dur: 0.22, gain: 0.45, freq: 1400, type: 'lowpass', q: 0.7 })
    this.burst({ dur: 0.05, gain: 0.3, freq: 3500, type: 'highpass', q: 0.5 })
    this.tone({ freq: 130, dur: 0.16, type: 'sine', gain: 0.32, slideTo: 45 })
  }

  /** the two note till chime */
  private coin() {
    this.tone({ freq: 988, dur: 0.09, type: 'square', gain: 0.09 })
    this.tone({ freq: 1319, dur: 0.18, type: 'square', gain: 0.09, at: 0.08 })
  }

  /** a few muffled crunches */
  private eat() {
    this.burst({ dur: 0.07, gain: 0.2, freq: 700, q: 1.2, type: 'bandpass' })
    this.burst({ dur: 0.08, gain: 0.16, freq: 520, q: 1.2, type: 'bandpass', at: 0.11 })
    this.burst({ dur: 0.07, gain: 0.14, freq: 820, q: 1.4, type: 'bandpass', at: 0.22 })
  }

  /** two falling gulps */
  private drink() {
    this.tone({ freq: 420, dur: 0.1, type: 'sine', gain: 0.16, slideTo: 260 })
    this.tone({ freq: 340, dur: 0.12, type: 'sine', gain: 0.14, at: 0.13, slideTo: 200 })
  }

  /** a long sigh down into sleep */
  private sleep() {
    this.tone({ freq: 440, dur: 0.7, type: 'sine', gain: 0.15, slideTo: 180 })
    this.burst({ dur: 0.6, gain: 0.05, freq: 500, q: 0.6, type: 'lowpass', at: 0.15 })
  }
}

export const sfx = new Sfx()
