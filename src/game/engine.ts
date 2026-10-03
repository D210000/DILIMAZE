import {
  CITIES_PER_REGION,
  TS,
  clueAssist,
  generateCity,
  guardRankName,
  REGIONS,
  regionIndexForCity,
} from './city'
import { DEFAULT_SKIN_ID } from './brand'
import { cleanLook, saveProfile, type CameraMode, type LookMode, type Profile, type RunState } from './profile'
import { recordCityTime, recordRun } from './records'
import { RNG } from './rng'
import { sfx } from './sound'
import type { CharacterPose, Guard, PlayerState, Prop, Puzzle, TileKind, Toast, Vec, World } from './types'

export interface DialogData {
  title: string
  lines: string[]
}

export interface Snapshot {
  status:
    | 'title'
    | 'briefing'
    | 'playing'
    | 'dialog'
    | 'puzzle'
    | 'caught'
    | 'collapsed'
    | 'cityCleared'
    | 'victory'
  city: number
  region: string
  day: number
  hour: number
  night: boolean
  hunger: number
  thirst: number
  health: number
  coins: number
  food: number
  water: number
  hasPass: boolean
  cluesFound: number
  cluesTotal: number
  promptText: string | null
  dialog: DialogData | null
  puzzle: { puzzle: Puzzle; clueIndex: number; tries: number; nudge: string | null } | null
  toasts: Toast[]
  caughtTimer: number
  deathReason: string
  /** which camera the run is using: the raised map or the eye level street cam */
  camera: CameraMode
  /** how the mouse turns the street camera: left drag, free look, or neither */
  look: LookMode
  daysInCity: number
  deaths: number
  totalDays: number
  nearSafehouse: boolean
  guardsAlerted: number
  /** how many guards currently have a shot in the air */
  shotsAtYou: number
  /** the city type for this level (Neon Metro, Timber Village, ...) */
  cityType: string
  /** who is on your heels right now, by rank or by count ('' when clear) */
  chasedBy: string
  /** avatar skin id (brand.ts registry) */
  skin: string
  regionId: string
  regionIndex: number
  /** true once the first clue of this city is found — unlocks readable clue text */
  clueKnown: boolean
  /** riddle describing where the clue the player is hunting sits */
  clueHint: string
  /** plain-language locator for that same clue — the anti-frustration line */
  clueHintLine: string
  /** locator for clue #1, shown while the chain text is still scrambled */
  clueEntry: string
  /** how close the player is to the next clue; null when it's already pinpointed */
  signal: 'cold' | 'faint' | 'warm' | 'hot' | null
  /** hint revealed after repeated wrong answers on the open puzzle */
  puzzleNudge: string | null
  playerName: string
  /** stopwatch for the city being played, in seconds */
  cityTimeSec: number
  /** stopwatch for the whole session, in seconds */
  runTimeSec: number
  /**
   * Signal tracker on the next clue. Only present in the first few cities and for
   * the first two clues of a chain — after that the riddles are all you get.
   */
  clueTrack: { angle: number; distanceTiles: number } | null
}

export interface GameOptions {
  /** avatar skin id from the brand registry */
  skinId?: string
  /** when supplied, progress/stats are written straight into it (autosave) */
  profile?: Profile | null
  /** mid-run survival state to restore (same city only) */
  resume?: RunState | null
}

/** how often mid-run state is flushed to the profile, in seconds */
const AUTOSAVE_INTERVAL = 10

/**
 * A city day is a full 24 hour clock that opens at 6am: `frac` 0 is sunrise,
 * 0.5 is 6pm, 0.75 is midnight and 1.0 wraps back round to sunrise. The light
 * therefore starts at full sun and falls away through the afternoon into night,
 * then lifts again just before the next morning so the loop has no hard cut.
 */
export const DAY_START_HOUR = 6

/** widest the night wash ever gets (see render.ts) */
export const MAX_DARKNESS = 0.5

/**
 * How far the street camera turns (yaw) per pixel of pointer travel. A dial
 * that is easy to overshoot makes the whole street view feel twitchy, so this
 * is deliberately gentle: a full sweep across a laptop trackpad is a modest
 * turn, not a spin.
 */
export const LOOK_YAW_PER_PX = 0.0024
/** how far the street camera tilts (pitch) per pixel of pointer travel */
export const LOOK_PITCH_PER_PX = 0.0016

/**
 * Free look follows every pointer move with no button to hold, so the same
 * pixel travel reads faster than a deliberate left button drag. Scaling it
 * down a touch keeps simply hovering the mouse from whipping the view round.
 */
export const LOOK_FREE_SCALE = 0.7

/**
 * The single source of truth for how light it is. render.ts paints from
 * `darkness`; guards sharpen their senses from `night`. Keeping both in one
 * function means the picture and the stealth rules can never disagree.
 */
export function dayLight(frac: number): { darkness: number; night: boolean } {
  const f = Math.min(1, Math.max(0, frac))
  let darkness: number
  if (f < 0.5) darkness = 0 // 06:00 to 18:00, full sun
  else if (f < 0.75) darkness = MAX_DARKNESS * ((f - 0.5) / 0.25) // dusk, 18:00 to midnight
  else if (f < 0.875) darkness = MAX_DARKNESS // the small hours
  else darkness = MAX_DARKNESS * (1 - (f - 0.875) / 0.125) // dawn climb back to sunrise
  // guards get sharper once the street is genuinely dim, not at the first hint of dusk
  return { darkness, night: darkness >= 0.3 }
}

/** shortest way round the circle from `a` toward `b`, eased by `t` (0..1) */
function approachAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * Math.min(1, Math.max(0, t))
}

/**
 * The runner's right hand in the street view, in world axes: the camera's
 * forward (cos yaw, sin yaw) turned a quarter turn clockwise as seen from
 * above. The walk mapping and the street renderer both read this one function,
 * so stepping right and the camera's right edge can never disagree.
 */
export function streetRight(yaw: number): { x: number; y: number } {
  return { x: -Math.sin(yaw), y: Math.cos(yaw) }
}

/** clock hour (0 to 23) for a day fraction, so the HUD agrees with the light */
export function dayHour(frac: number): number {
  const f = Math.min(1, Math.max(0, frac))
  return Math.floor((DAY_START_HOUR + f * 24) % 24)
}

/**
 * Coaching for an open puzzle, based on how many times the player has missed.
 * A riddle is never a hard blocker: three misses earns a genuine hint and five
 * hands the answer over, so nobody is stuck on a quiz in the middle of a run.
 */
function puzzleNudge(puz: Puzzle, tries: number): string | null {
  if (tries < 3) return null
  const giveUp = tries >= 5
  switch (puz.kind) {
    case 'word': {
      const first = puz.answer[0]
      const last = puz.answer[puz.answer.length - 1]
      return giveUp
        ? `The word is ${puz.answer}. Type it in.`
        : `${puz.answer.length} letters: starts with "${first}", ends with "${last}".`
    }
    case 'code':
      return giveUp ? `The code is ${puz.answer}.` : 'Multiply first, then add the last number.'
    case 'choice':
      return giveUp
        ? `The answer is "${puz.options[puz.answer] ?? ''}".`
        : 'Read the story again. One of the options matches it.'
    case 'sequence':
      return giveUp
        ? `Tap them in this order: ${puz.answer.map((i) => puz.shown[i]).join(' ')}`
        : `Start with ${puz.shown[puz.answer[0]]}.`
    default:
      return null
  }
}

export class Game {
  world: World
  player: PlayerState
  status: Snapshot['status'] = 'playing'
  day = 1
  timeSec = 0 // seconds into current day
  daysInCity = 1
  deaths: number
  totalDays: number
  dialog: DialogData | null = null
  activePuzzle: { puzzle: Puzzle; clueIndex: number; tries: number; nudge: string | null } | null = null
  toasts: Toast[] = []
  private toastId = 1
  promptText: string | null = null
  /** live stopwatch for the city being played, and for the whole session run */
  cityTimeSec = 0
  runTimeSec = 0
  /** cities finished since this engine was created (a full run needs 100) */
  private clearedThisSession = 0
  caughtTimer = 0
  deathReason = ''
  /** 1 -> 0 after a guard lands a shot; the renderer paints a red flash with it */
  hitFlash = 0
  private shotToastCd = 0
  private keys = new Set<string>()
  private wantInteract = false
  private wantClimb = false
  private wantHide = false
  private wantRun = false
  private touchRun = false
  private nearProp: Prop | null = null
  private nearSafehouse = false
  private climbCooldown = 0
  private lastFrame = 0
  private acc = 0
  private listeners = new Set<() => void>()
  private rng = new RNG(Date.now() >>> 0)
  private uiTick = 0
  private profile: Profile | null
  private skinId: string
  private saveAccum = 0
  /** counts down to the next footstep while the runner is on the move */
  private stepTimer = 0
  /** was a dialog or puzzle panel up last frame, so its opening cue fires once */
  private boxOpen = false
  /** see Snapshot.camera — set from the profile at boot, toggled in game */
  cameraMode: CameraMode = 'top'
  /**
   * How the mouse turns the street camera. The input wiring lives in the view
   * layer, which reads this and nothing else, so the choice is one field here
   * and one setting in the profile.
   */
  lookMode: LookMode = 'drag'
  /**
   * Heading of the street camera, in radians. The renderer looks along it and
   * the street view walks relative to it, so W always heads into the screen.
   */
  camYaw = 0
  /** look up or down a little, in the street view (mouse drag / touch) */
  camPitch = 0
  /** where the street camera is aiming; camYaw and camPitch ease toward it */
  private yawTarget = 0
  private pitchTarget = 0
  /** seconds left during which the player's look wins over the walk recentre */
  private lookHold = 0

  constructor(city: number, deaths = 0, totalDays = 0, opts: GameOptions = {}) {
    this.world = generateCity(Math.max(1, Math.min(100, Math.round(city))))
    this.deaths = deaths
    this.totalDays = totalDays
    this.profile = opts.profile ?? null
    // the saved mute flag drives the whole sound subsystem from one place
    sfx.setEnabled(this.profile ? this.profile.settings.sound !== false : true)
    this.skinId = opts.skinId ?? this.profile?.skin ?? DEFAULT_SKIN_ID
    this.cameraMode = this.profile?.settings.camera === 'walk' ? 'walk' : 'top'
    this.lookMode = this.profile ? cleanLook(this.profile.settings.look) : 'drag'
    this.player = this.makePlayer(opts.resume ?? null)
    this.camYaw = this.player.facing
    if (this.profile) {
      this.profile.stats.attempts++
      this.profile.skin = this.skinId
      this.checkpoint()
    }
  }

  setSkin(skinId: string) {
    this.skinId = skinId
    if (this.profile) this.profile.skin = skinId
    this.checkpoint()
    this.emit()
  }

  getSkin(): string {
    return this.skinId
  }

  /**
   * Switch between the raised map view and the eye level street camera. Writing
   * straight through to the profile means the choice is remembered next time the
   * runner plays, and it never touches the save's integrity fingerprint.
   */
  setCameraMode(mode: CameraMode) {
    const next = mode === 'walk' ? 'walk' : 'top'
    // stepping into the street view starts the camera behind the runner, so the
    // first frame already looks the way they were heading
    if (next === 'walk' && this.cameraMode !== 'walk') {
      this.camYaw = this.player.facing
      this.yawTarget = this.player.facing
      this.camPitch = 0
      this.pitchTarget = 0
    }
    this.cameraMode = next
    if (this.profile) {
      this.profile.settings.camera = this.cameraMode
      saveProfile(this.profile)
    }
    this.emit()
  }

  toggleCamera(): CameraMode {
    this.setCameraMode(this.cameraMode === 'walk' ? 'top' : 'walk')
    return this.cameraMode
  }

  /**
   * Choose how the mouse looks around: hold the left button and sweep, follow
   * the mouse freely with no button at all, or leave looking to touch and the
   * keyboard. Written straight through to the profile so it is remembered, and
   * kept out of the save fingerprint so it can never cost anyone a run.
   */
  setLookMode(mode: LookMode) {
    this.lookMode = cleanLook(mode)
    if (this.profile) {
      this.profile.settings.look = this.lookMode
      saveProfile(this.profile)
    }
    this.emit()
  }

  /**
   * Look around from the street camera. Only the AIM moves here, and the real
   * heading eases toward it every frame, which is what keeps a turn smooth
   * instead of snapped. `dx` and `dy` are the pointer's own movement in pixels,
   * delivered while a drag is held, so the view turns by how far the mouse or
   * finger just travelled and never by where the pointer happens to sit: a cursor
   * parked toward one edge cannot send the camera spinning on its own. Ignored by
   * the map view, which has no heading.
   */
  look(dx: number, dy: number) {
    if (this.cameraMode !== 'walk') return
    // a fast flick really does arrive as one big jump, so the cap is generous: it
    // only exists to stop a wild event (a tab switch, a stray pointer jump) from
    // snapping the view round
    const scale = this.lookMode === 'free' ? LOOK_FREE_SCALE : 1
    const cx = Math.max(-120, Math.min(120, dx * scale))
    const cy = Math.max(-120, Math.min(120, dy * scale))
    this.yawTarget += cx * LOOK_YAW_PER_PX
    this.pitchTarget = Math.max(-0.45, Math.min(0.45, this.pitchTarget + cy * LOOK_PITCH_PER_PX))
    this.lookHold = 1.1
  }

  /** the aim eases toward the target, so every look is a smooth turn */
  private easeLook(dt: number) {
    if (this.cameraMode !== 'walk') return
    if (this.lookHold > 0) this.lookHold -= dt
    const k = Math.min(1, dt * 6)
    this.camYaw = approachAngle(this.camYaw, this.yawTarget, k)
    this.camPitch += (this.pitchTarget - this.camPitch) * k
  }

  private makePlayer(resume: RunState | null = null): PlayerState {
    const base: PlayerState = {
      x: this.world.spawn.x * TS,
      y: this.world.spawn.y * TS,
      vx: 0,
      vy: 0,
      facing: 0,
      hunger: 100,
      thirst: 100,
      health: 100,
      coins: 10 + Math.floor(this.world.city / 10) * 5,
      food: 1,
      water: 1,
      hidden: false,
      mountedProp: null,
      clueIndex: 0,
      hasPass: false,
      anim: 0,
      moving: false,
      running: false,
      pose: 'idle' as CharacterPose,
      poseTimer: 0,
    }
    // resuming the same city keeps hunger/thirst/coins and clue progress
    if (resume && resume.city === this.world.city) {
      base.hunger = resume.hunger
      base.thirst = resume.thirst
      base.health = resume.health
      base.coins = resume.coins
      base.food = resume.food
      base.water = resume.water
      base.clueIndex = Math.max(0, Math.min(this.world.clues.length, resume.clueIndex))
      base.hasPass = base.clueIndex >= this.world.clues.length
    }
    return base
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  // ---- input ------------------------------------------------------------

  setKey(code: string, down: boolean) {
    if (down) this.keys.add(code)
    else this.keys.delete(code)
    this.wantRun = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
  }

  // mobile: pushing the joystick to its edge means run
  setTouchRun(run: boolean) {
    this.touchRun = run
  }

  /** transient pose (climb / sleep / interact) that overrides the walk cycle */
  private setPose(pose: CharacterPose, seconds: number) {
    this.player.pose = pose
    this.player.poseTimer = seconds
  }

  action(kind: 'interact' | 'climb' | 'hide' | 'eat' | 'drink' | 'sleep') {
    if (kind === 'interact') this.wantInteract = true
    if (kind === 'climb') this.wantClimb = true
    if (kind === 'hide') this.wantHide = true
    if (kind === 'eat') this.eat()
    if (kind === 'drink') this.drink()
    if (kind === 'sleep') this.trySleep()
  }

  private axis(): { x: number; y: number } {
    let x = 0
    let y = 0
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1
    return { x, y }
  }

  setTouchAxis(x: number, y: number) {
    this.touchAxis = { x, y }
  }
  private touchAxis: { x: number; y: number } = { x: 0, y: 0 }

  // ---- loop -------------------------------------------------------------

  /**
   * Step the simulation by hand (clamped like a real frame). The render loop
   * drives this via rAF; the dev self-test uses it to play whole cities without
   * waiting in real time.
   */
  tick(dt: number) {
    this.update(Math.max(0, Math.min(0.25, dt)))
  }

  start() {
    this.lastFrame = performance.now()
    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - this.lastFrame) / 1000)
      this.lastFrame = t
      this.update(dt)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  private update(dt: number) {
    // transient effects keep ticking even while an overlay is up, so a shot
    // flash never sticks to the screen after a death or a puzzle
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 1.6)
    if (this.shotToastCd > 0) this.shotToastCd -= dt
    // a dialog or puzzle panel is a "box" opening: cue it once on the rising edge
    const box = this.dialog !== null || this.activePuzzle !== null
    if (box && !this.boxOpen) sfx.play('open')
    this.boxOpen = box
    const playing =
      this.status === 'playing' || this.status === 'caught' || this.status === 'cityCleared' || this.status === 'collapsed'
    if (!playing) {
      this.emitThrottled()
      return
    }

    if (this.status === 'caught') {
      this.caughtTimer -= dt
      if (this.caughtTimer <= 0) this.restartDay()
      this.emitThrottled()
      return
    }
    if (this.status === 'collapsed') {
      this.caughtTimer -= dt
      if (this.caughtTimer <= 0) this.restartCity()
      this.emitThrottled()
      return
    }
    if (this.status === 'cityCleared') {
      this.caughtTimer -= dt
      if (this.caughtTimer <= 0) this.nextCity()
      this.emitThrottled()
      return
    }

    const step = 1 / 120
    this.acc += dt
    let guard = 0
    while (this.acc >= step && guard < 30) {
      this.simulate(step)
      this.acc -= step
      guard++
    }

    // profile bookkeeping + periodic autosave
    if (this.profile) this.profile.stats.timePlayedSec += dt
    // the ranking stopwatches only run while the player is actually playing:
    // menus, dialogs, puzzles and overlays are excluded because update() bails
    // out early for every non playing status
    this.cityTimeSec += dt
    this.runTimeSec += dt
    this.saveAccum += dt
    if (this.saveAccum >= AUTOSAVE_INTERVAL) {
      this.saveAccum = 0
      this.checkpoint()
    }

    // find nearby interactable
    this.nearProp = null
    let bestD2 = (1.6 * TS) ** 2
    for (const p of this.world.props) {
      if (p.used) continue
      const dx = p.x - this.player.x
      const dy = p.y - this.player.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        this.nearProp = p
      }
    }
    this.nearSafehouse = this.world.props.some(
      (p) => p.data === 'sleep' && (p.x - this.player.x) ** 2 + (p.y - this.player.y) ** 2 < (2 * TS) ** 2,
    )

    this.promptText = this.computePrompt()

    if (this.wantInteract) {
      this.wantInteract = false
      this.doInteract()
    }
    if (this.wantClimb) {
      this.wantClimb = false
      this.tryClimb()
    }
    if (this.wantHide) {
      this.wantHide = false
      this.toggleHide()
    }

    this.timeSec += dt
    if (this.timeSec >= this.world.dayLengthSec) {
      this.timeSec -= this.world.dayLengthSec
      this.day++
      this.daysInCity++
      this.totalDays++
      // sleeping was skipped: night caught you in the open
      if (!this.player.hidden) this.toast('You slept rough. The night took its toll.', 'bad')
      this.checkpoint()
    }

    this.emitThrottled()
  }

  private simulate(dt: number) {
    const p = this.player
    const input = this.axis()
    input.x += this.touchAxis.x
    input.y += this.touchAxis.y
    const iLen = Math.hypot(input.x, input.y)
    if (iLen > 1) {
      input.x /= iLen
      input.y /= iLen
    }

    // How the stick maps onto the world depends on the camera:
    //  - the map view walks the world axes (up on screen is north);
    //  - the street view walks relative to where the camera looks, so W always
    //    heads into the screen and A / D step sideways across it.
    let wx = input.x
    let wy = input.y
    if (this.cameraMode === 'walk') {
      const fwd = -input.y
      const strafe = input.x
      const cs = Math.cos(this.camYaw)
      const sn = Math.sin(this.camYaw)
      // The camera looks along (cos, sin). The runner's right hand is that
      // forward turned a quarter turn clockwise, seen from above, which is the
      // very vector the street renderer draws with. Sharing it means D always
      // steps toward the right edge of the view and A toward the left.
      const right = streetRight(this.camYaw)
      wx = cs * fwd + right.x * strafe
      wy = sn * fwd + right.y * strafe
      const wl = Math.hypot(wx, wy)
      if (wl > 1) {
        wx /= wl
        wy /= wl
      }
      // pushing forward swings the camera round behind the runner; a strafe or a
      // step back leaves the heading alone so the street never spins underfoot.
      // While the player is looking around, their aim wins and the recentre waits.
      const looking = this.lookHold > 0
      if (!looking && fwd > 0.12 && Math.abs(fwd) >= Math.abs(strafe)) {
        this.yawTarget = approachAngle(this.yawTarget, Math.atan2(wy, wx), dt * 3.4)
      }
    }

    const len = Math.hypot(wx, wy)
    p.moving = len > 0.1
    p.running = (this.wantRun || this.touchRun) && p.moving && !p.hidden
    this.stepSound(dt)

    // walk-cycle pose, unless a transient pose (climb / sleep / interact) is playing
    if (p.poseTimer > 0) p.poseTimer -= dt
    else if (p.hidden) p.pose = 'crouch'
    else p.pose = p.moving ? 'run' : 'idle'

    const baseSpeed = 3.6 * TS
    const runSpeed = 5.6 * TS
    const speed = (p.running ? runSpeed : baseSpeed) * (p.hidden ? 0.4 : 1) * (p.hunger <= 0 || p.thirst <= 0 ? 0.55 : 1)

    const targetVx = wx * speed
    const targetVy = wy * speed
    p.vx += (targetVx - p.vx) * Math.min(1, dt * 12)
    p.vy += (targetVy - p.vy) * Math.min(1, dt * 12)

    this.moveWithCollision(p, dt)
    this.collectCoins()

    if (p.moving) {
      p.facing = Math.atan2(wy, wx)
      p.anim += dt * (p.running ? 14 : 9)
    }

    // stat drain per in-game hour
    const hoursPerSec = 24 / this.world.dayLengthSec
    const mult = p.running ? 1.5 : 1
    p.hunger = Math.max(0, p.hunger - this.world.drainPerHour.hunger * hoursPerSec * dt * mult)
    p.thirst = Math.max(0, p.thirst - this.world.drainPerHour.thirst * hoursPerSec * dt * mult)
    if (p.hunger <= 0) p.health = Math.max(0, p.health - dt * 2.2)
    if (p.thirst <= 0) p.health = Math.max(0, p.health - dt * 3.2)
    if (p.health <= 0) {
      this.deathReason =
        p.thirst <= 0
          ? 'You died of thirst.'
          : p.hunger <= 0
            ? 'You starved.'
            : 'A guard shot you down in the street.'
      this.status = 'collapsed'
      this.caughtTimer = 2.2
      this.deaths++
      if (this.profile) this.profile.stats.deaths++
      this.saveMeta()
      return
    }

    // the street camera eases toward wherever it has been aimed
    this.easeLook(dt)

    // climb cooldown
    if (this.climbCooldown > 0) this.climbCooldown -= dt

    // night visibility handled in renderer; here guards get sharper at night
    this.updateGuards(dt)

    // gate check
    const g = this.world.gate
    if (
      p.hasPass &&
      p.x > (this.world.w - 1) * TS &&
      Math.abs(p.y - g.y * TS) < 1.5 * TS
    ) {
      this.status = 'cityCleared'
      this.caughtTimer = 2.0
      sfx.play('clear')
      this.saveMeta()
      return
    }
  }

  /**
   * Footstep cadence. A step fires on a fixed beat while the runner is moving,
   * shorter and sharper while running, and the beat resets the moment they stop
   * so standing still is silent and the first step back is immediate.
   */
  private stepSound(dt: number) {
    const p = this.player
    if (!p.moving) {
      this.stepTimer = 0
      return
    }
    this.stepTimer -= dt
    if (this.stepTimer <= 0) {
      sfx.play(p.running ? 'stepRun' : 'step')
      this.stepTimer = p.running ? 0.27 : 0.4
    }
  }

  /** the runner is a body, not a point: this is how far their edge reaches */
  private static readonly BODY_R = 9

  /**
   * Is one tile blocking for the runner? Buildings, water, the map edge and the
   * locked gate all hold. The one exception is a block that offers something to
   * interact with (a shop, a bar, a house with food or water): you are meant to
   * step up to those. Everything else keeps its border.
   */
  private tileSolid(tx: number, ty: number, hasPass: boolean): boolean {
    if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return true
    const t = this.world.tiles[ty * this.world.w + tx]
    if (t === 'water' || t === 'wall') return true
    if (t === 'gate') return !hasPass
    if (t !== 'building') return false
    return !this.tileHasInteractable(tx, ty)
  }

  /** does this tile carry a prop the player is meant to walk up to? */
  private tileHasInteractable(tx: number, ty: number): boolean {
    const cx = tx * TS + TS / 2
    const cy = ty * TS + TS / 2
    for (const pr of this.world.props) {
      if (pr.used) continue
      if (Math.abs(pr.x - cx) > TS / 2 || Math.abs(pr.y - cy) > TS / 2) continue
      if (pr.kind === 'shop' || pr.kind === 'house' || pr.kind === 'bar') return true
      if (pr.data === 'food' || pr.data === 'water') return true
    }
    return false
  }

  /**
   * Sample the runner's whole footprint, not just their centre, against solid
   * tiles. Testing only the centre let the sprite slide its shoulders into a
   * block and read as though it had climbed the wall; ringing the body around
   * the centre keeps the border honest while still fitting through one tile gaps.
   */
  private bodyBlocked(x: number, y: number, hasPass: boolean): boolean {
    const r = Game.BODY_R
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      if (this.tileSolid(Math.floor((x + Math.cos(a) * r) / TS), Math.floor((y + Math.sin(a) * r) / TS), hasPass))
        return true
    }
    return this.tileSolid(Math.floor(x / TS), Math.floor(y / TS), hasPass)
  }

  private moveWithCollision(p: PlayerState, dt: number) {
    const propBlock = (x: number, y: number): boolean => {
      for (const pr of this.world.props) {
        if (!pr.blocking || pr.used) continue
        if (pr.id === p.mountedProp) continue
        if (Math.abs(pr.x - x) < 14 && Math.abs(pr.y - y) < 14) return true
      }
      return false
    }
    const blocked = (x: number, y: number) => this.bodyBlocked(x, y, p.hasPass) || propBlock(x, y)

    const nx = p.x + p.vx * dt
    if (!blocked(nx, p.y)) p.x = nx
    else p.vx = 0
    const ny = p.y + p.vy * dt
    if (!blocked(p.x, ny)) p.y = ny
    else p.vy = 0

    // gate tile lets you walk only rightward at the right edge
    if (p.x > this.world.w * TS) p.x = this.world.w * TS
  }

  // ---- guards -----------------------------------------------------------

  private updateGuards(dt: number) {
    const p = this.player
    const night = this.isNight()
    for (const gd of this.world.guards) {
      // A guard that has been grinding against the same corner for three seconds
      // is wedged, not walking: nudge it onto the nearest clear tile and let it
      // pick its route up again. Cheaper and more reliable than perfect paths.
      if (gd.stuckTimer > 3) {
        this.unstickGuard(gd)
        gd.stuckTimer = 0
      }
      if (!this.guardTileOpen(gd.x, gd.y)) {
        this.unstickGuard(gd)
        gd.detourPath = []
        gd.detourTarget = null
      }
      const dist = Math.hypot(p.x - gd.x, p.y - gd.y)
      const angleTo = Math.atan2(p.y - gd.y, p.x - gd.x)
      let angDiff = Math.abs(((angleTo - gd.dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const trackerPing = gd.role === 'tracker' && p.hidden && dist < 3 * TS && this.lineOfSight(gd.x, gd.y, p.x, p.y)
      const visible =
        (!p.hidden || trackerPing) &&
        dist < gd.visionDist * (night ? 0.6 : 1) &&
        angDiff < gd.visionHalfAngle * (night ? 1.2 : 1) &&
        this.lineOfSight(gd.x, gd.y, p.x, p.y)

      if (visible) {
        gd.alert = Math.min(1, gd.alert + dt * (dist < 2.5 * TS ? 3 : 1.4))
        gd.lastSeen = { x: p.x, y: p.y }
      } else {
        gd.alert = Math.max(0, gd.alert - dt * 0.25)
      }

      if (gd.alert >= 1 && gd.state !== 'chase') {
        gd.state = 'chase'
        this.toast(`A ${guardRankName(gd)} spotted you!`, 'bad')
        sfx.play('spotted')
      }

      // ---- ranged guards ----------------------------------------------
      // A shooter only needs you lit up in its cone, not a full chase: it holds
      // still and puts a round downrange. Long and wide watchers simply see much
      // further / much wider than a brawler, and close in like everyone else.
      if (gd.flash > 0) gd.flash = Math.max(0, gd.flash - dt)
      if (gd.attackCd > 0) gd.attackCd = Math.max(0, gd.attackCd - dt)
      if (gd.abilityCd > 0) gd.abilityCd = Math.max(0, gd.abilityCd - dt)
      if (gd.burstTimer > 0) gd.burstTimer = Math.max(0, gd.burstTimer - dt)
      if (gd.role === 'gun' && gd.alert > 0.4 && visible && gd.attackCd <= 0 && dist > 2.2 * TS) {
        gd.attackCd = Math.max(0.8, 1.95 - gd.tier * 0.12 - this.world.city * 0.004)
        gd.flash = 0.18
        gd.shotAt = { x: p.x, y: p.y }
        sfx.play('gunshot')
        // A round is a bullet, not a bee sting: from a full bar three hits are
        // always enough to put the runner down, and deeper cities drop that to
        // two. It is capped at 50 so no single shot can ever be a one hit kill.
        const dmg = Math.min(50, Math.max(34, 34 + gd.tier * 3 + Math.floor(this.world.city / 12) * 4 + (gd.captain ? 6 : 0)))
        p.health = Math.max(0, p.health - dmg)
        this.hitFlash = 1
        if (this.shotToastCd <= 0) {
          this.shotToastCd = 3.5
          this.toast(`The ${guardRankName(gd)} is shooting at you! Find cover.`, 'bad')
        }
      }

      switch (gd.state) {
        case 'suspicious':
          gd.searchTimer -= dt
          if (gd.searchTimer <= 0) gd.state = 'patrol'
          break
        case 'chase': {
          const tx = gd.lastSeen?.x ?? p.x
          const ty = gd.lastSeen?.y ?? p.y
          if (gd.role === 'charger' && gd.burstTimer <= 0 && gd.abilityCd <= 0 && gd.alert > 0.4) {
            gd.burstTimer = 0.7
            gd.abilityCd = Math.max(3.2, 5.4 - gd.tier * 0.35 - this.world.city * 0.012)
          }
          // Chargers get short pursuit bursts, with a hard cap just below the
          // runner's sprint so the special still has a reliable counterplay.
          const speedScale = (night ? 1.1 : 1) * (gd.burstTimer > 0 ? 1.22 : 1)
          const spd = Math.min(5.5, gd.speed * speedScale) * TS
          const dx = tx - gd.x
          const dy = ty - gd.y
          // a shooter holds its ground in the open and fires instead of closing
          const holding = gd.role === 'gun' && visible && dist < gd.visionDist * 0.92
          if (!holding) {
            if (!this.moveGuardToward(gd, tx, ty, spd * dt)) {
              gd.stuckTimer += dt
              if (gd.stuckTimer > 4) {
                gd.state = 'search'
                gd.searchTimer = 2.5
                gd.stuckTimer = 0
              }
            } else gd.stuckTimer = 0
          }
          gd.dir = Math.atan2(dy, dx)
          if (dist < 18 && !p.hidden) {
            this.caught(gd)
            return
          }
          if (gd.alert <= 0.05) {
            gd.state = 'search'
            gd.searchTimer = 3
          }
          break
        }
        case 'search': {
          gd.searchTimer -= dt
          if (gd.searchTimer <= 0) {
            gd.state = 'return'
          }
          break
        }
        case 'return': {
          const target = gd.path[gd.wp]
          const dx = target.x * TS - gd.x
          const dy = target.y * TS - gd.y
          const d = Math.hypot(dx, dy) || 1
          const moved = this.moveGuardToward(gd, target.x * TS, target.y * TS, gd.speed * TS * dt)
          gd.dir = Math.atan2(dy, dx)
          if (!moved && Math.hypot(dx, dy) > 10) {
            gd.stuckTimer += dt
            if (gd.stuckTimer > 4) {
              gd.state = 'patrol'
              gd.stuckTimer = 0
            }
          } else gd.stuckTimer = 0
          if (d < 12) {
            gd.state = 'patrol'
            gd.alert = 0
          }
          break
        }
      }

      if (gd.state === 'patrol') {
        const target = gd.path[gd.wp]
        const dx = target.x * TS - gd.x
        const dy = target.y * TS - gd.y
        const d = Math.hypot(dx, dy) || 1
        if (d < 10) {
          gd.wp = (gd.wp + 1) % gd.path.length
        } else {
          const moved = this.moveGuardToward(gd, target.x * TS, target.y * TS, gd.speed * TS * 0.6 * dt)
          gd.dir = Math.atan2(dy, dx)
          if (!moved) {
            // the straight line to this stop is walled off: skip to the next one
            // and, if that keeps failing, the top of the loop frees the guard
            gd.stuckTimer += dt
            gd.wp = (gd.wp + 1) % gd.path.length
          } else gd.stuckTimer = 0
        }
      }
      // suspicious transition
      if (gd.state === 'patrol' && gd.alert > 0.4 && gd.alert < 1) {
        gd.state = 'suspicious'
        gd.searchTimer = 1.5
      }
    }
  }

  /**
   * $DLI is pocketed on contact: no keypress, no prompt, just walk over it. The
   * tokens sit on the pavement as bait in the open, so having to stop and press
   * E made a pickup a small stealth risk for no good reason.
   */
  private collectCoins() {
    const p = this.player
    const reach = 0.9 * TS
    for (const prop of this.world.props) {
      if (prop.kind !== 'coin' || prop.used) continue
      if ((prop.x - p.x) ** 2 + (prop.y - p.y) ** 2 > reach * reach) continue
      prop.used = true
      const dli = this.rng.int(2, 5)
      p.coins += dli
      this.toast(`+${dli} $DLI`, 'good')
      sfx.play('coin')
    }
  }

  private guardSolidMove(gd: Guard, dx: number, dy: number): boolean {
    const before = { x: gd.x, y: gd.y }
    const solid = (x: number, y: number): boolean => {
      const tx = Math.floor(x / TS)
      const ty = Math.floor(y / TS)
      if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return true
      const t = this.world.tiles[ty * this.world.w + tx]
      return t === 'building' || t === 'water' || t === 'wall'
    }
    const propBlock = (x: number, y: number): boolean => {
      for (const pr of this.world.props) {
        if (!pr.blocking || pr.used) continue
        if (pr.climbable && Math.abs(pr.y - y) < 10) continue // guards step over crates
        if (Math.abs(pr.x - x) < 14 && Math.abs(pr.y - y) < 14) return true
      }
      return false
    }
    // Sample the guard's footprint, not just its center. Without this margin a
    // sprite could drift through a block corner while its center stayed outside.
    const clear = (x: number, y: number) => {
      const radius = 8
      for (const [ox, oy] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius * 0.7, radius * 0.7], [-radius * 0.7, radius * 0.7], [radius * 0.7, -radius * 0.7], [-radius * 0.7, -radius * 0.7]]) {
        if (solid(x + ox, y + oy) || propBlock(x + ox, y + oy)) return false
      }
      return true
    }
    // Small substeps prevent a fast patrol or chase from skipping over a thin
    // collision edge between frames.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4))
    for (let i = 0; i < steps; i++) {
      const sx = dx / steps
      const sy = dy / steps
      if (clear(gd.x + sx, gd.y)) gd.x += sx
      if (clear(gd.x, gd.y + sy)) gd.y += sy
    }
    return Math.hypot(gd.x - before.x, gd.y - before.y) > 0.01
  }

  private guardTileOpen(x: number, y: number): boolean {
    const tx = Math.floor(x / TS)
    const ty = Math.floor(y / TS)
    if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return false
    const tile = this.world.tiles[ty * this.world.w + tx]
    return tile === 'road' || tile === 'sidewalk' || tile === 'plaza' || tile === 'park'
  }

  /** Walk directly where possible; otherwise cache a four-way grid route. */
  private moveGuardToward(gd: Guard, targetX: number, targetY: number, distance: number): boolean {
    const targetTile = { x: Math.floor(targetX / TS), y: Math.floor(targetY / TS) }
    const sameTarget = gd.detourTarget?.x === targetTile.x && gd.detourTarget?.y === targetTile.y
    if (!sameTarget) {
      gd.detourPath = []
      gd.detourWp = 0
      gd.detourTarget = { x: targetTile.x, y: targetTile.y }
    }
    const directDx = targetX - gd.x
    const directDy = targetY - gd.y
    const directD = Math.hypot(directDx, directDy)
    if (directD <= distance + 1) {
      const moved = this.guardSolidMove(gd, directDx, directDy)
      if (moved) gd.detourPath = []
      return moved
    }
    if (gd.detourPath.length === 0 || gd.detourWp >= gd.detourPath.length) {
      gd.detourPath = this.findGuardRoute(gd, targetTile.x, targetTile.y)
      gd.detourWp = 0
    }
    const next = gd.detourPath[gd.detourWp]
    if (!next) return this.guardSolidMove(gd, (directDx / (directD || 1)) * distance, (directDy / (directD || 1)) * distance)
    const nx = next.x * TS
    const ny = next.y * TS
    const dx = nx - gd.x
    const dy = ny - gd.y
    const d = Math.hypot(dx, dy)
    if (d < 5) {
      gd.detourWp++
      return true
    }
    const moved = this.guardSolidMove(gd, (dx / d) * Math.min(distance, d), (dy / d) * Math.min(distance, d))
    if (!moved) {
      gd.detourPath = []
      gd.detourWp = 0
      gd.detourTarget = null
    }
    return moved
  }

  private findGuardRoute(gd: Guard, targetX: number, targetY: number): Vec[] {
    const w = this.world.w
    const h = this.world.h
    const startX = Math.floor(gd.x / TS)
    const startY = Math.floor(gd.y / TS)
    const start = startY * w + startX
    const open = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false
      const tile = this.world.tiles[y * w + x]
      if (!(tile === 'road' || tile === 'sidewalk' || tile === 'plaza' || tile === 'park')) return false
      const cx = (x + 0.5) * TS
      const cy = (y + 0.5) * TS
      return !this.world.props.some((prop) =>
        prop.blocking && !prop.used && Math.abs(prop.x - cx) < 17 && Math.abs(prop.y - cy) < 17,
      )
    }
    if (!open(startX, startY)) return []
    const previous = new Int32Array(w * h).fill(-2)
    const queue = new Int32Array(w * h)
    let head = 0
    let tail = 0
    queue[tail++] = start
    previous[start] = -1
    let found = -1
    let best = start
    let bestDistance = Infinity
    while (head < tail) {
      const at = queue[head++]
      const x = at % w
      const y = Math.floor(at / w)
      const dTarget = Math.abs(x - targetX) + Math.abs(y - targetY)
      if (dTarget < bestDistance) { bestDistance = dTarget; best = at }
      if (x === targetX && y === targetY) { found = at; break }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (!open(nx, ny)) continue
        const ni = ny * w + nx
        if (previous[ni] !== -2) continue
        previous[ni] = at
        queue[tail++] = ni
      }
    }
    if (found < 0) found = best
    const route: Vec[] = []
    for (let at = found; at >= 0 && at !== start; at = previous[at]) {
      route.push({ x: (at % w) + 0.5, y: (Math.floor(at / w)) + 0.5 })
    }
    route.reverse()
    return route
  }

  /**
   * Drop a wedged guard onto the middle of the nearest tile it can stand on.
   * The search sweeps outward a ring at a time, so the guard shifts as little as
   * possible and never ends up inside a building or out in the water.
   */
  private unstickGuard(gd: Guard) {
    const OPEN = (t: TileKind | undefined) =>
      t === 'road' || t === 'sidewalk' || t === 'plaza' || t === 'park'
    const blocked = (tx: number, ty: number): boolean => {
      if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return true
      const t = this.world.tiles[ty * this.world.w + tx]
      if (t === 'building' || t === 'water' || t === 'wall') return true
      const x = (tx + 0.5) * TS
      const y = (ty + 0.5) * TS
      return this.world.props.some((prop) =>
        prop.blocking && !prop.used && Math.abs(prop.x - x) < 17 && Math.abs(prop.y - y) < 17,
      )
    }
    const gx = Math.floor(gd.x / TS)
    const gy = Math.floor(gd.y / TS)
    // prefer proper pavement so a freed guard lands back on a road; only if the
    // whole neighbourhood is a block do we settle for any solid ground tile
    for (const pass of [0, 1]) {
      for (let r = 1; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
            const tx = gx + dx
            const ty = gy + dy
            if (blocked(tx, ty)) continue
            if (pass === 0 && !OPEN(this.world.tiles[ty * this.world.w + tx])) continue
            gd.x = (tx + 0.5) * TS
            gd.y = (ty + 0.5) * TS
            return
          }
        }
      }
    }
  }

  private lineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (TS / 2))
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      const x = x1 + (x2 - x1) * t
      const y = y1 + (y2 - y1) * t
      const tx = Math.floor(x / TS)
      const ty = Math.floor(y / TS)
      if (tx < 0 || ty < 0 || tx >= this.world.w || ty >= this.world.h) return false
      const tile = this.world.tiles[ty * this.world.w + tx]
      if (tile === 'building' || tile === 'wall') return false
    }
    return true
  }

  private caught(gd: Guard) {
    this.status = 'caught'
    this.caughtTimer = 2.4
    gd.alert = 0
    gd.state = 'search'
    gd.searchTimer = 3
    const lostFood = Math.min(this.player.food, 1)
    this.player.food -= lostFood
    const fine = Math.min(this.player.coins, 5 + Math.floor(this.world.city / 10) * 2)
    this.player.coins -= fine
    this.player.hunger = Math.max(0, this.player.hunger - 15)
    this.player.thirst = Math.max(0, this.player.thirst - 15)
    const rank = guardRankName(gd)
    this.toast(
      fine > 0
        ? `The ${rank} caught you and took ${fine} $DLI${lostFood ? ' plus your food' : ''}. Back to the checkpoint.`
        : `The ${rank} caught you${lostFood ? ' and took your food' : ''}. Back to the checkpoint.`,
      'bad',
    )
  }

  // ---- interactions -----------------------------------------------------

  private computePrompt(): string | null {
    const p = this.nearProp
    if (!p) {
      if (this.nearSafehouse) return 'Sleep (T) until morning'
      return null
    }
    switch (p.kind) {
      case 'fountain':
        return 'Drink (E) from the fountain'
      case 'shop':
        return p.data === 'food' ? 'Shop: buy food (E, 8 $DLI)' : 'Shop: buy water (E, 8 $DLI)'
      case 'house':
        return p.data === 'food' ? 'Ask for food (E)' : 'Ask for water (E)'
      case 'trash':
        return 'Search trash (E). Risky'
      case 'board':
      case 'bar':
      case 'kid':
      case 'radio':
      case 'graffiti':
        return p.data === 'clue' ? 'Investigate clue (E)' : 'Chat (E). Maybe gossip'
      case 'stall':
        return 'Market stall: food 6 $DLI / water 6 $DLI (E)'
      default:
        return null
    }
  }

  private doInteract() {
    const p = this.player
    const prop = this.nearProp
    if (prop) this.setPose('interact', 0.6)
    if (this.nearSafehouse && !prop) {
      this.trySleep()
      return
    }
    if (!prop) return
    switch (prop.kind) {
      case 'fountain':
        p.thirst = 100
        this.toast('You drank deeply. Thirst quenched.', 'good')
        sfx.play('drink')
        break
      case 'shop':
        if (prop.data === 'food') {
          if (p.coins >= 8) {
            p.coins -= 8
            p.food++
            this.toast('Bought food for 8 $DLI.', 'good')
          } else this.toast('Not enough $DLI (need 8).', 'bad')
        } else {
          if (p.coins >= 8) {
            p.coins -= 8
            p.water++
            this.toast('Bought water for 8 $DLI.', 'good')
          } else this.toast('Not enough $DLI (need 8).', 'bad')
        }
        break
      case 'stall':
        if (p.coins >= 6) {
          p.coins -= 6
          if (this.rng.chance(0.5)) p.food++
          else p.water++
          this.toast('Bought something from the stall for 6 $DLI.', 'good')
        } else this.toast('Not enough $DLI (need 6).', 'bad')
        break
      case 'house': {
        const success = this.rng.chance(0.65)
        if (success) {
          if (prop.data === 'food') {
            p.food++
            this.toast('A kind stranger gave you food.', 'good')
          } else {
            p.water++
            this.toast('A kind stranger gave you water.', 'good')
          }
          prop.used = true
        } else {
          this.toast('The door stayed shut. Nobody home.', 'info')
          // small chance of a guard alert
          if (this.rng.chance(0.25)) {
            for (const gd of this.world.guards) gd.alert = Math.min(1, gd.alert + 0.35)
          }
        }
        break
      }
      case 'trash': {
        prop.used = true
        const roll = this.rng.next()
        if (roll < 0.3) {
          p.food++
          this.toast('Found half a sandwich in the trash. Not bad.', 'good')
        } else if (roll < 0.5) {
          p.water++
          this.toast('Found a bottle of water.', 'good')
        } else if (roll < 0.62) {
          const dli = this.rng.int(2, 6)
          p.coins += dli
          this.toast(`Found +${dli} $DLI in the trash!`, 'good')
        } else if (roll < 0.72) {
          this.toast('The trash was sickening. You feel ill.', 'bad')
          p.health = Math.max(20, p.health - 12)
        } else {
          this.toast('Nothing but old papers. (bin emptied)', 'info')
        }
        break
      }
      case 'coin': {
        prop.used = true
        const dli = this.rng.int(2, 5)
        p.coins += dli
        this.toast(`+${dli} $DLI`, 'good')
        break
      }
      case 'board':
      case 'bar':
      case 'kid':
      case 'radio':
      case 'graffiti':
        if (prop.data === 'clue') this.openClue(prop)
        else this.gossip(prop)
        break
      default:
        break
    }
  }

  private gossip(prop: Prop) {
    prop.used = true
    prop.data = 'spent' // renderer shows it as already-talked
    const city = this.world.city
    const lines = [
      `Trouble in ${this.world.region.name} these days. Guards everywhere.`,
      `They say City ${city + 1} is worse. If you make it there.`,
      'The border gate needs a pass. No pass, no exit.',
      'Water is free at the fountains. Food will cost you.',
      'Sleep on benches. Streets are dangerous at night.',
      'I saw the courier. Ask the landmarks: boards, radios, kids. They know things.',
    ]
    const i = this.rng.int(0, lines.length - 1)
    this.dialog = { title: 'Local', lines: [lines[i]] }
    this.status = 'dialog'
  }

  private openClue(prop: Prop) {
    const idx = this.player.clueIndex
    const clue = this.world.clues[idx]
    if (!clue || clue.propId !== prop.id) {
      // wrong landmark: give vague flavor
      this.dialog = {
        title: 'Dead end',
        lines: ['"You are looking in the wrong place, friend."'],
      }
      this.status = 'dialog'
      return
    }
    if (clue.puzzle) {
      this.activePuzzle = { puzzle: clue.puzzle, clueIndex: idx, tries: 0, nudge: null }
      this.status = 'puzzle'
      return
    }
    this.grantClue(idx)
  }

  grantClue(idx: number) {
    const clue = this.world.clues[idx]
    this.player.clueIndex = idx + 1
    if (this.profile) this.profile.stats.solves++
    // the locator line rides along with every clue, so the trail never goes cold
    const locator = clue.hint ? [`Hint: ${clue.hint.replace(/^Hint: /, '')}`] : []
    if (this.player.clueIndex >= this.world.clues.length) {
      this.player.hasPass = true
      this.toast('BORDER PASS acquired! Get to the east gate!', 'good')
      this.dialog = {
        title: 'Border pass',
        lines: [
          clue.riddle,
          ...locator,
          '"Here. The stamp. The gate to the east will open for you. Go, before the shift changes."',
        ],
      }
    } else {
      this.toast('Clue found! Follow the trail.', 'good')
      this.dialog = { title: 'Clue', lines: [clue.riddle, ...locator] }
    }
    this.status = 'dialog'
  }

  answerPuzzle(answer: string | number | number[]) {
    const active = this.activePuzzle
    if (!active) return
    const puz = active.puzzle
    let ok = false
    if (puz.kind === 'word') ok = String(answer).trim().toUpperCase() === puz.answer
    else if (puz.kind === 'code') ok = String(answer).trim() === puz.answer
    else if (puz.kind === 'choice') ok = answer === puz.answer
    else if (puz.kind === 'sequence') {
      if (!Array.isArray(answer)) {
        this.toast('Pick the symbols in order.', 'info')
        return
      }
      ok = (answer as number[]).length === puz.answer.length && (answer as number[]).every((v, i) => v === puz.answer[i])
    }
    if (ok) {
      this.activePuzzle = null
      this.grantClue(active.clueIndex)
    } else {
      // brute-forcing a riddle never gets the player stuck: after a few misses
      // the panel starts coaching, and an outright giveaway comes with the rest
      active.tries++
      active.nudge = puzzleNudge(puz, active.tries)
      this.toast(active.nudge ? 'Wrong. But here is a nudge...' : 'Wrong! Think again...', 'bad')
      this.status = 'puzzle'
    }
  }

  closeDialog() {
    this.dialog = null
    if (this.status === 'dialog') this.status = 'playing'
  }

  cancelPuzzle() {
    this.activePuzzle = null
    if (this.status === 'puzzle') this.status = 'playing'
  }

  // ---- survival actions -------------------------------------------------

  eat() {
    if (this.player.food <= 0) {
      this.toast('No food left.', 'bad')
      return
    }
    this.player.food--
    this.player.hunger = Math.min(100, this.player.hunger + 55)
    this.player.health = Math.min(100, this.player.health + 8)
    this.toast('You ate. Hunger eased.', 'good')
    sfx.play('eat')
  }

  drink() {
    if (this.player.water <= 0) {
      this.toast('No water left.', 'bad')
      return
    }
    this.player.water--
    this.player.thirst = Math.min(100, this.player.thirst + 60)
    this.player.health = Math.min(100, this.player.health + 6)
    this.toast('You drank. Thirst eased.', 'good')
    sfx.play('drink')
  }

  private trySleep() {
    if (!this.nearSafehouse) {
      this.toast('Find a bench or a safe corner to sleep.', 'info')
      return
    }
    // sleep: advance to the next sunrise (day fraction 0), restore some health,
    // drain stats a bit. Time still passes, so the ranking stopwatch keeps going.
    const daySecs = this.world.dayLengthSec
    const elapsed = this.timeSec
    const toMorning = daySecs - elapsed
    const hours = (toMorning / daySecs) * 24
    const p = this.player
    p.hunger = Math.max(0, p.hunger - hours * this.world.drainPerHour.hunger)
    p.thirst = Math.max(0, p.thirst - hours * this.world.drainPerHour.thirst)
    p.health = Math.min(100, p.health + 25)
    this.timeSec = 0
    this.day++
    this.daysInCity++
    this.totalDays++
    // reset guards to patrol
    for (const gd of this.world.guards) {
      gd.state = 'patrol'
      gd.alert = 0
      const wp = gd.path[gd.wp]
      gd.x = wp.x * TS
      gd.y = wp.y * TS
    }
    this.setPose('sleep', 1.6)
    this.toast(`You slept until morning. Day ${this.day}.`, 'info')
    sfx.play('sleep')
    this.saveMeta()
  }

  private tryClimb() {
    if (this.climbCooldown > 0) return
    // find nearest climbable within range
    let best: Prop | null = null
    let bestD2 = (1.7 * TS) ** 2
    for (const p of this.world.props) {
      if (!p.climbable || p.used) continue
      const d2 = (p.x - this.player.x) ** 2 + (p.y - this.player.y) ** 2
      if (d2 < bestD2) {
        bestD2 = d2
        best = p
      }
    }
    if (!best) {
      this.toast('Nothing to climb here.', 'info')
      return
    }
    this.climbCooldown = 0.8
    this.setPose('climb', 0.55)
    // climbing lets you pass through: briefly become non-solid by vaulting over
    const dirx = Math.cos(this.player.facing)
    const diry = Math.sin(this.player.facing)
    const overX = this.player.x + dirx * 30
    const overY = this.player.y + diry * 30
    // the vault must land the whole body on open ground, never on or over a
    // building border — a climb is a hop along the street, not onto a roof
    if (this.bodyBlocked(overX, overY, this.player.hasPass)) {
      this.toast("Can't climb in that direction.", 'info')
      return
    }
    this.player.x = overX
    this.player.y = overY
    this.player.anim = 0
    this.toast('Vaulted over.', 'info')
    if (this.rng.chance(0.12)) {
      this.player.coins += 1
      this.toast('+1 $DLI up top!', 'good')
    }
  }

  private toggleHide() {
    const p = this.player
    if (p.hidden) {
      p.hidden = false
      this.toast('You stepped out.', 'info')
      return
    }
    let best: Prop | null = null
    let bestD2 = (1.7 * TS) ** 2
    for (const prop of this.world.props) {
      if (!prop.hide || prop.used) continue
      const d2 = (prop.x - p.x) ** 2 + (prop.y - p.y) ** 2
      if (d2 < bestD2) {
        bestD2 = d2
        best = prop
      }
    }
    if (!best) {
      this.toast('Nothing to hide in here.', 'info')
      return
    }
    p.hidden = true
    this.toast('Hidden. Hold still...', 'good')
  }

  // ---- transitions ------------------------------------------------------

  private saveMeta() {
    this.checkpoint()
  }

  /** public: flush right now (used when leaving the game from the HUD) */
  saveNow() {
    this.checkpoint()
  }

  /**
   * One autosave checkpoint: mid-run survival state + career progress.
   * Called on city completion, day rollover, sleep, death and every
   * AUTOSAVE_INTERVAL seconds of live play.
   */
  private checkpoint() {
    const prof = this.profile
    if (!prof) return
    const pl = this.player
    prof.run = {
      city: this.world.city,
      day: this.day,
      daysInCity: this.daysInCity,
      hunger: pl.hunger,
      thirst: pl.thirst,
      health: pl.health,
      coins: pl.coins,
      food: pl.food,
      water: pl.water,
      clueIndex: pl.clueIndex,
    }
    prof.bestCity = Math.max(prof.bestCity, this.world.city)
    prof.skin = this.skinId
    saveProfile(prof)
  }

  /**
   * Clearing all 20 cities of a region reveals its lore snippet.
   * `silent` just records the unlock (used on the final victory city).
   */
  private unlockRegionLore(regionIndex: number, silent = false) {
    const region = REGIONS[regionIndex]
    if (!region) return
    const already = this.profile?.lore[region.id] === true
    if (this.profile) {
      this.profile.lore[region.id] = true
      saveProfile(this.profile)
    }
    if (silent) return
    this.toast(`${region.name}: all ${CITIES_PER_REGION} cities cleared. Lore unlocked.`, 'good')
    this.dialog = {
      title: already ? `AGAIN: ${region.name}` : `REGION CLEARED: ${region.name}`,
      lines: [region.lore],
    }
    this.status = 'dialog'
  }

  restartDay() {
    // caught: keep day, reset guards + position
    this.status = 'playing'
    this.player.x = this.world.spawn.x * TS
    this.player.y = this.world.spawn.y * TS
    this.player.hidden = false
    this.player.facing = 0
    this.camYaw = 0
    this.yawTarget = 0
    for (const gd of this.world.guards) {
      gd.state = 'patrol'
      gd.alert = 0
      const wp = gd.path[0]
      gd.x = wp.x * TS
      gd.y = wp.y * TS
    }
    this.checkpoint()
  }

  restartCity() {
    this.status = 'playing'
    this.day = 1
    this.daysInCity = 1
    // a death restarts the level, so its stopwatch starts over too
    this.cityTimeSec = 0
    this.player = this.makePlayer()
    this.camYaw = this.player.facing
    this.yawTarget = this.player.facing
    for (const gd of this.world.guards) {
      gd.state = 'patrol'
      gd.alert = 0
      const wp = gd.path[0]
      gd.x = wp.x * TS
      gd.y = wp.y * TS
    }
    for (const p of this.world.props) {
      if (p.kind === 'coin') p.used = false
      if (p.kind === 'trash') p.used = false
    }
    this.toast(`Back to Day 1 of City ${this.world.city}. Stay alive this time.`, 'bad')
    this.saveAccum = 0
    this.checkpoint()
  }

  nextCity() {
    const cleared = this.world.city
    const next = cleared + 1
    if (this.profile) this.profile.stats.citiesCleared++
    // bank the level timer for the ranking board before the stopwatch resets
    recordCityTime(cleared, this.cityTimeSec)
    this.clearedThisSession++
    this.cityTimeSec = 0

    if (next > 100) {
      if (cleared % CITIES_PER_REGION === 0) this.unlockRegionLore(regionIndexForCity(cleared), true)
      // only a run taken from City 1 to City 100 in one sitting counts as a
      // full run record; resuming halfway cannot produce an honest total
      if (this.clearedThisSession >= 100) recordRun(this.runTimeSec)
      this.status = 'victory'
      this.checkpoint()
      return
    }

    // Everything the runner is carrying crosses the border with them: DLI, food,
    // water, and the survival bars themselves. Entering a new city is not a rest
    // stop — the clock resets to morning, but hunger, thirst and health carry on
    // exactly where they were. Only a death (`restartCity`) wipes them.
    const carry = {
      coins: this.player.coins,
      food: this.player.food,
      water: this.player.water,
      hunger: this.player.hunger,
      thirst: this.player.thirst,
      health: this.player.health,
    }
    this.world = generateCity(next)
    this.player = this.makePlayer()
    this.player.coins = carry.coins
    this.player.food = carry.food
    this.player.water = carry.water
    this.player.hunger = carry.hunger
    this.player.thirst = carry.thirst
    this.player.health = carry.health
    this.day = 1
    this.daysInCity = 1
    this.timeSec = 0
    this.status = 'playing'
    // The camera crosses the border too, and whatever heading the runner left
    // the last city with would open this one staring sideways at the border.
    // Snapping it to the entry heading (east, down the road into town) means the
    // first frame of a new city is always the road ahead.
    this.camYaw = this.player.facing
    this.yawTarget = this.player.facing
    this.camPitch = 0
    this.pitchTarget = 0
    this.lookHold = 0
    this.saveAccum = 0
    this.checkpoint()
    this.toast(
      `City ${next}: ${this.world.region.name}, a ${this.world.archetype.name}. ${next === 100 ? 'THE LAST CITY. Almost free!' : 'Find the clue trail.'}`,
      'info',
    )
    // a full region cleared: hand over its lore snippet
    if (cleared % CITIES_PER_REGION === 0) this.unlockRegionLore(regionIndexForCity(cleared))
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    this.toasts.push({ id: this.toastId++, text, kind, t: 3.5 })
    if (this.toasts.length > 4) this.toasts.shift()
  }

  private tickToasts(dt: number) {
    for (const t of this.toasts) t.t -= dt
    this.toasts = this.toasts.filter((t) => t.t > 0)
  }

  isNight(): boolean {
    return dayLight(this.timeSec / this.world.dayLengthSec).night
  }

  private emitThrottled() {
    this.tickToasts(1 / 60)
    this.uiTick++
    if (this.uiTick % 4 === 0) this.emit()
  }

  getSnapshot(): Snapshot {
    const frac = this.timeSec / this.world.dayLengthSec
    const hour = dayHour(frac)
    const chasing = this.world.guards.filter((g) => g.state === 'chase')
    return {
      status: this.status,
      city: this.world.city,
      region: this.world.region.name,
      day: this.day,
      hour,
      night: this.isNight(),
      hunger: this.player.hunger,
      thirst: this.player.thirst,
      health: this.player.health,
      coins: this.player.coins,
      food: this.player.food,
      water: this.player.water,
      hasPass: this.player.hasPass,
      cluesFound: this.player.clueIndex,
      cluesTotal: this.world.clues.length,
      promptText: this.promptText,
      dialog: this.dialog,
      puzzle: this.activePuzzle,
      toasts: [...this.toasts],
      caughtTimer: this.caughtTimer,
      deathReason: this.deathReason,
      camera: this.cameraMode,
      look: this.lookMode,
      daysInCity: this.daysInCity,
      deaths: this.deaths,
      totalDays: this.totalDays,
      nearSafehouse: this.nearSafehouse,
      guardsAlerted: chasing.length,
      shotsAtYou: this.world.guards.filter((g) => g.flash > 0).length,
      cityType: this.world.archetype.name,
      chasedBy:
        chasing.length === 0
          ? ''
          : chasing.length === 1
            ? `the ${guardRankName(chasing[0])}`
            : `${chasing.length} guards`,
      skin: this.skinId,
      regionId: this.world.region.id,
      regionIndex: regionIndexForCity(this.world.city),
      clueKnown: this.player.clueIndex > 0,
      // the riddle the player is working on is the one handed out with the clue
      // they just found — clues[i].riddle points at clues[i + 1]
      clueHint: this.currentClue()?.riddle ?? '',
      clueHintLine: this.currentClue()?.hint ?? '',
      clueEntry: this.world.entryHint,
      signal: this.signal(),
      puzzleNudge: this.activePuzzle?.nudge ?? null,
      playerName: this.profile?.name ?? 'Runner',
      clueTrack: this.clueTrack(),
      cityTimeSec: this.cityTimeSec,
      runTimeSec: this.runTimeSec,
    }
  }

  /**
   * The clue being hunted right now: `clues[i].riddle` describes the target of
   * `clues[i + 1]`, so after finding clue `i` the player needs `clues[i]` —
   * i.e. the entry one step behind `clueIndex`. Once the pass is granted the
   * final riddle (which points at the gate) is the one to show.
   */
  private currentClue() {
    const clues = this.world.clues
    if (!clues.length) return null
    const i = this.player.clueIndex - 1
    return clues[Math.max(0, Math.min(clues.length - 1, i))]
  }

  /**
   * How warm the player is: a coarse proximity band to the next clue, so long
   * unguided chains are still solvable by walking around. Only for clues the
   * tracker arrow does NOT already pinpoint.
   */
  private signal(): Snapshot['signal'] {
    if (this.player.hasPass) return null
    const idx = this.player.clueIndex
    if (clueAssist(this.world.city, idx)) return null
    const clue = this.world.clues[idx]
    if (!clue) return null
    const prop = this.world.propAt.get(clue.propId)
    if (!prop) return null
    const d = Math.hypot(prop.x - this.player.x, prop.y - this.player.y) / TS
    if (d < 3.5) return 'hot'
    if (d < 10) return 'warm'
    if (d < 20) return 'faint'
    return 'cold'
  }

  /** direction + distance to the next clue — opening cities only, first two clues */
  private clueTrack(): Snapshot['clueTrack'] {
    if (!clueAssist(this.world.city, this.player.clueIndex)) return null
    const clue = this.world.clues[this.player.clueIndex]
    if (!clue || this.player.hasPass) return null
    const prop = this.world.propAt.get(clue.propId)
    if (!prop) return null
    const dx = prop.x - this.player.x
    const dy = prop.y - this.player.y
    return {
      angle: Math.atan2(dy, dx),
      distanceTiles: Math.round(Math.hypot(dx, dy) / TS),
    }
  }
}
