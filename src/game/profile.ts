import { DEFAULT_SKIN_ID, SKINS } from './brand'
import { REGIONS } from './city'

/**
 * Profile + save system. localStorage only, no backend.
 *
 * Hardening rules (see the audit notes in README):
 *  - every storage touch is wrapped in try/catch; missing or blocked storage
 *    falls back to a fresh in-memory profile so the game always runs;
 *  - the payload is size-capped before parsing, so a bloated value can't hang
 *    the tab;
 *  - the saved object carries a fingerprint. It is NOT tamper-proof (the salt
 *    ships in the bundle and any played-out state is reproducible client-side),
 *    but hand-editing the save in devtools is detected and the progress reset;
 *  - unknown keys are never copied through, so a crafted payload cannot pollute
 *    Object.prototype or smuggle extra state into the profile;
 *  - the display name is sanitized (no control / bidi-override characters).
 */

export const PROFILE_KEY = 'borderrun_profile'
export const MAX_LIVES = 3
/** old pre-profile save key, migrated into the profile on first load */
const LEGACY_KEY = 'border-run-save-v1'

/** refuse to JSON.parse anything bigger than this (DoS guard) */
const MAX_SAVE_CHARS = 64 * 1024

/**
 * Bump when the fingerprint inputs change. Saves written by an older
 * fingerprint are treated as legacy (accepted and re-signed) rather than
 * tampered, so future format changes never wipe real progress.
 */
const SIG_VERSION = 3
const SIG_SALT = 'dilimaze.cities.v1'

export interface RunState {
  city: number
  day: number
  daysInCity: number
  hunger: number
  thirst: number
  health: number
  coins: number
  food: number
  water: number
  clueIndex: number
  livesRemaining: number
  cooldownUntil: number
  /** collectible lives saved for later runs; separate from the city's lives */
  bankedLives: number
}

/** One life returns per city-minute while the runner is below capacity. */
export function recoverRunLives(run: Pick<RunState, 'city' | 'livesRemaining' | 'cooldownUntil'>, now = Date.now()) {
  let livesRemaining = int(run.livesRemaining, 0, MAX_LIVES, 3)
  let cooldownUntil = int(run.cooldownUntil, 0, Number.MAX_SAFE_INTEGER, 0)
  const interval = Math.max(1, Math.round(run.city)) * 60_000
  while (livesRemaining < MAX_LIVES && cooldownUntil > 0 && cooldownUntil <= now) {
    livesRemaining++
    cooldownUntil = livesRemaining < MAX_LIVES ? cooldownUntil + interval : 0
  }
  if (livesRemaining >= MAX_LIVES) cooldownUntil = 0
  return { livesRemaining, cooldownUntil }
}

export interface ProfileStats {
  attempts: number
  solves: number
  deaths: number
  citiesCleared: number
  timePlayedSec: number
}

export type CameraMode = 'top' | 'walk'

export interface ProfileSettings {
  sound: boolean
  /**
   * Which camera the run opens with: `top` is the raised map view the game has
   * always used, `walk` is the eye level street camera. Cosmetic on purpose, so
   * it is deliberately left OUT of the integrity fingerprint: switching view
   * must never cost a player their save.
   */
  camera: CameraMode
  /**
   * How the mouse turns the street camera: `drag` holds the left button and
   * sweeps, `free` follows every mouse move with no button at all, `off` leaves
   * looking to touch and the keyboard. Cosmetic on purpose, so like the camera
   * choice it is deliberately left OUT of the integrity fingerprint: changing
   * how you look must never cost a player their save.
   */
  look: LookMode
}

export type LookMode = 'drag' | 'free' | 'off'

/** coerce anything into a valid camera mode, defaulting to the map view */
export function cleanCamera(v: unknown): CameraMode {
  return v === 'walk' ? 'walk' : 'top'
}

/** coerce anything into a valid look mode, defaulting to the left button drag */
export function cleanLook(v: unknown): LookMode {
  return v === 'free' ? 'free' : v === 'off' ? 'off' : 'drag'
}

export interface Profile {
  version: number
  name: string
  skin: string
  createdAt: number
  updatedAt: number
  /** highest city reached — everything <= this is unlocked on the map */
  bestCity: number
  /** resumable mid-run survival state for `bestCity` */
  run: RunState | null
  stats: ProfileStats
  settings: ProfileSettings
  /** regionId -> lore snippet unlocked (all 20 cities of that region cleared) */
  lore: Record<string, boolean>
  onboarded: boolean
  /**
   * true once the first-time tutorial has been played through. Deliberately NOT
   * part of the fingerprint below: it only gates a hint screen, so reads as a
   * normal field on saves written before the tutorial existed.
   */
  tutorialSeen?: boolean
  /** set when a corrupt save was replaced — the UI mentions it once */
  corruptRecovered?: boolean
  /** set when an edited save failed its integrity check */
  tamperRecovered?: boolean
  /** fingerprint of this payload + the fingerprint format that produced it */
  sig?: string
  sigv?: number
}

export const PROFILE_VERSION = 1

/* ------------------------------------------------------------------ */
/* storage plumbing                                                    */
/* ------------------------------------------------------------------ */

let memoryFallback: Profile | null = null

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage
    if (!s) return null
    const probe = '__borderrun_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt
  return Math.min(max, Math.max(min, n))
}

function int(v: unknown, min: number, max: number, dflt: number): number {
  return Math.round(clampNum(v, min, max, dflt))
}

/**
 * Display names are rendered as text (React escapes them, and canvas fillText
 * is inert), but control characters and Unicode bidi overrides could still
 * scramble or spoof the UI. Strip them, cap the length.
 */
function cleanName(v: unknown, dflt: string): string {
  if (typeof v !== 'string') return dflt
  const cleaned = v
    // control chars, zero-width joiners, bidi overrides, BOM
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18)
  return cleaned.length ? cleaned : dflt
}

const REGION_IDS = REGIONS.map((r) => r.id)

/** only known region ids survive, so no key from a payload is ever trusted */
function cleanLore(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!raw || typeof raw !== 'object') return out
  const src = raw as Record<string, unknown>
  for (const id of REGION_IDS) if (src[id] === true) out[id] = true
  return out
}

export function freshRun(city = 1): RunState {
  return { city, day: 1, daysInCity: 1, hunger: 100, thirst: 100, health: 100, coins: 10, food: 1, water: 1, clueIndex: 0, livesRemaining: 3, cooldownUntil: 0, bankedLives: 0 }
}

export function freshProfile(name = 'Runner', skin = DEFAULT_SKIN_ID): Profile {
  const now = Date.now()
  return {
    version: PROFILE_VERSION,
    name: cleanName(name, 'Runner'),
    skin: SKINS.some((s) => s.id === skin) ? skin : DEFAULT_SKIN_ID,
    createdAt: now,
    updatedAt: now,
    bestCity: 1,
    run: null,
    stats: { attempts: 0, solves: 0, deaths: 0, citiesCleared: 0, timePlayedSec: 0 },
    settings: { sound: true, camera: 'top', look: 'drag' },
    lore: {},
    onboarded: false,
    tutorialSeen: false,
  }
}

/* ------------------------------------------------------------------ */
/* integrity fingerprint                                               */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a over a canonical, key-ordered projection of the save. Deterministic
 * across save/load, and cheap enough to run on every autosave.
 */
function fingerprint(p: Profile): string {
  const canon = [
    p.version,
    p.name,
    p.skin,
    Math.round(p.createdAt),
    p.bestCity,
    p.run
      ? [
          p.run.city,
          p.run.day,
          p.run.daysInCity,
          Math.round(p.run.hunger),
          Math.round(p.run.thirst),
          Math.round(p.run.health),
          p.run.coins,
          p.run.food,
          p.run.water,
          p.run.clueIndex,
          p.run.livesRemaining,
          p.run.cooldownUntil,
          p.run.bankedLives,
        ].join(',')
      : '-',
    [
      p.stats.attempts,
      p.stats.solves,
      p.stats.deaths,
      p.stats.citiesCleared,
      Math.round(p.stats.timePlayedSec),
    ].join(','),
    p.settings.sound ? 1 : 0,
    Object.keys(p.lore).filter((k) => p.lore[k] === true).sort().join('+'),
    p.onboarded ? 1 : 0,
  ].join('|')

  const s = `${SIG_SALT}|${canon}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** clamp/round every field the fingerprint covers, so save and load agree */
function normalize(p: Profile): Profile {
  p.version = PROFILE_VERSION
  p.name = cleanName(p.name, 'Runner')
  if (!SKINS.some((s) => s.id === p.skin)) p.skin = DEFAULT_SKIN_ID
  p.createdAt = int(p.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  p.bestCity = int(p.bestCity, 1, 100, 1)
  p.stats = {
    attempts: int(p.stats.attempts, 0, 1e7, 0),
    solves: int(p.stats.solves, 0, 1e7, 0),
    deaths: int(p.stats.deaths, 0, 1e7, 0),
    citiesCleared: int(p.stats.citiesCleared, 0, 1e7, 0),
    timePlayedSec: Math.max(0, Number.isFinite(p.stats.timePlayedSec) ? p.stats.timePlayedSec : 0),
  }
  p.settings = {
    sound: p.settings.sound !== false,
    camera: cleanCamera(p.settings.camera),
    look: cleanLook(p.settings.look),
  }
  p.lore = cleanLore(p.lore)
  p.onboarded = p.onboarded === true
  p.tutorialSeen = p.tutorialSeen === true
  // structural repair, never destructive: a resumable run must belong to a city
  // already reached. (Progress is only ever wiped by an exact fingerprint
  // mismatch below — heuristics must never delete a real player's save.)
  if (p.run && typeof p.run === 'object' && int(p.run.city, 1, 100, 1) > p.bestCity) p.run = null
  if (p.run && typeof p.run === 'object') {
    p.run = {
      city: int(p.run.city, 1, 100, 1),
      day: int(p.run.day, 1, 9999, 1),
      daysInCity: int(p.run.daysInCity, 1, 9999, 1),
      hunger: clampNum(p.run.hunger, 0, 100, 100),
      thirst: clampNum(p.run.thirst, 0, 100, 100),
      health: clampNum(p.run.health, 0, 100, 100),
      coins: int(p.run.coins, 0, 99999, 10),
      food: int(p.run.food, 0, 99, 1),
      water: int(p.run.water, 0, 99, 1),
      clueIndex: int(p.run.clueIndex, 0, 9, 0),
      livesRemaining: int(p.run.livesRemaining, 0, MAX_LIVES, 3),
      cooldownUntil: int(p.run.cooldownUntil, 0, Number.MAX_SAFE_INTEGER, 0),
      bankedLives: int(p.run.bankedLives, 0, 99999, 0),
    }
  } else {
    p.run = null
  }
  return p
}

/* ------------------------------------------------------------------ */
/* load / save                                                         */
/* ------------------------------------------------------------------ */

/** Coerce anything we pulled out of storage into a valid Profile. */
function sanitize(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  const base = freshProfile()
  const stats = (d.stats ?? {}) as Record<string, unknown>
  const settings = (d.settings ?? {}) as Record<string, unknown>
  const runRaw = d.run
  const run = runRaw && typeof runRaw === 'object' ? (runRaw as Record<string, unknown>) : null
  const lore = cleanLore(d.lore)
  // The first time tour is for genuinely new runners. Saves written before the
  // tour existed carry no flag at all, so an account that has already been
  // played is treated as having seen it rather than dropping a tutorial on a
  // veteran the next time they press Play. A clean account keeps the tour.
  const played =
    clampNum(d.bestCity, 1, 100, 1) > 1 ||
    clampNum(stats.attempts, 0, 1e7, 0) > 0 ||
    clampNum(stats.citiesCleared, 0, 1e7, 0) > 0
  const tutorialSeen = typeof d.tutorialSeen === 'boolean' ? d.tutorialSeen : played

  const p: Profile = normalize({
    version: PROFILE_VERSION,
    name: cleanName(d.name, base.name),
    skin: typeof d.skin === 'string' ? d.skin : DEFAULT_SKIN_ID,
    createdAt: clampNum(d.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    updatedAt: clampNum(d.updatedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    bestCity: clampNum(d.bestCity, 1, 100, 1),
    run: run
      ? {
          city: clampNum(run.city, 1, 100, 1),
          day: clampNum(run.day, 1, 9999, 1),
          daysInCity: clampNum(run.daysInCity, 1, 9999, 1),
          hunger: clampNum(run.hunger, 0, 100, 100),
          thirst: clampNum(run.thirst, 0, 100, 100),
          health: clampNum(run.health, 0, 100, 100),
          coins: clampNum(run.coins, 0, 99999, 10),
          food: clampNum(run.food, 0, 99, 1),
          water: clampNum(run.water, 0, 99, 1),
          clueIndex: clampNum(run.clueIndex, 0, 9, 0),
          livesRemaining: clampNum(run.livesRemaining, 0, MAX_LIVES, 3),
          cooldownUntil: clampNum(run.cooldownUntil, 0, Number.MAX_SAFE_INTEGER, 0),
          bankedLives: clampNum(run.bankedLives, 0, 99999, 0),
        }
      : null,
    stats: {
      attempts: clampNum(stats.attempts, 0, 1e7, 0),
      solves: clampNum(stats.solves, 0, 1e7, 0),
      deaths: clampNum(stats.deaths, 0, 1e7, 0),
      citiesCleared: clampNum(stats.citiesCleared, 0, 1e7, 0),
      timePlayedSec: clampNum(stats.timePlayedSec, 0, 1e9, 0),
    },
    settings: {
      sound: settings.sound !== false,
      camera: cleanCamera(settings.camera),
      look: cleanLook(settings.look),
    },
    lore,
    onboarded: d.onboarded === true,
    tutorialSeen,
  })

  // integrity: the one and only destructive path. A present, current-generation
  // fingerprint that does not match the payload can only mean the save was
  // edited by hand — a real save is written by saveProfile(), which signs it.
  const sig = typeof d.sig === 'string' ? d.sig : null
  const sigv = int(d.sigv, 0, 1e6, 0)
  if (sig && sigv === SIG_VERSION && fingerprint(p) !== sig) {
    const wiped = freshProfile(p.name)
    wiped.createdAt = p.createdAt
    wiped.tamperRecovered = true
    return normalize(wiped)
  }
  return p
}

export function loadProfile(): Profile | null {
  const s = storage()
  if (!s) return memoryFallback
  let raw: string | null = null
  try {
    raw = s.getItem(PROFILE_KEY)
  } catch {
    return memoryFallback
  }

  if (raw) {
    if (raw.length > MAX_SAVE_CHARS) {
      // drop the bloated value so every later boot starts clean
      try {
        s.removeItem(PROFILE_KEY)
      } catch {
        /* ignore */
      }
      const oversized = freshProfile()
      oversized.corruptRecovered = true
      return oversized
    }
    try {
      const parsed = sanitize(JSON.parse(raw))
      if (parsed) return parsed
      // corrupt payload: keep the name if we can, otherwise start clean
      const nameGuess = /"name"\s*:\s*"([^"\\]{1,18})"/.exec(raw)?.[1]
      const rescued = freshProfile(nameGuess || 'Runner')
      rescued.corruptRecovered = true
      return rescued
    } catch {
      const nameGuess = /"name"\s*:\s*"([^"\\]{1,18})"/.exec(raw)?.[1]
      const rescued = freshProfile(nameGuess || 'Runner')
      rescued.corruptRecovered = true
      return rescued
    }
  }

  // one-time migration of the pre-profile save
  try {
    const legacyRaw = s.getItem(LEGACY_KEY)
    if (legacyRaw && legacyRaw.length < MAX_SAVE_CHARS) {
      const legacy = JSON.parse(legacyRaw) as { city?: number }
      if (typeof legacy.city === 'number') {
        const p = freshProfile()
        p.bestCity = int(legacy.city, 1, 100, 1)
        p.run = freshRun(p.bestCity)
        p.onboarded = false
        s.removeItem(LEGACY_KEY)
        return p
      }
    }
  } catch {
    /* unreadable legacy save: ignore it */
  }
  return null
}

export function saveProfile(p: Profile): boolean {
  p.updatedAt = Date.now()
  normalize(p)
  p.sigv = SIG_VERSION
  p.sig = fingerprint(p)
  const s = storage()
  if (!s) {
    memoryFallback = p
    return false
  }
  try {
    s.setItem(PROFILE_KEY, JSON.stringify(p))
    memoryFallback = p
    return true
  } catch {
    memoryFallback = p
    return false
  }
}

export function resetProfile(): void {
  memoryFallback = null
  try {
    globalThis.localStorage?.removeItem(PROFILE_KEY)
    globalThis.localStorage?.removeItem(LEGACY_KEY)
  } catch {
    /* nothing we can do */
  }
}

export function storageAvailable(): boolean {
  return storage() !== null
}
