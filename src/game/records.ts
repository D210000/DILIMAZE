/**
 * Ranking records: the fastest clear time the player has managed for every city
 * they have finished, plus completed full runs.
 *
 * This lives in its own localStorage key on purpose. The profile carries an
 * integrity fingerprint over an exact projection of its fields (see
 * profile.ts), so adding new data there would have meant changing that
 * projection and invalidating every existing save. Leaderboard data is not
 * progress, so it gets its own vault and its own, far softer, hygiene rules:
 * every value read back is clamped and re-validated, and unknown keys are never
 * copied through. A hand-edited value can produce a silly number, never a crash
 * and never a polluted object.
 *
 * There is no backend anywhere in this project, so the board is per device.
 */

export const RECORDS_KEY = 'borderrun_records'

/** refuse to JSON.parse anything bigger than this (DoS guard) */
const MAX_CHARS = 64 * 1024
/** city numbers the game can possibly report */
const MAX_CITY = 100
/** a single city clear longer than this is not a record, it is junk */
const MAX_CITY_SEC = 3600
const MAX_RUN_SEC = 24 * 3600
const MAX_RUNS = 20

export interface RunRecord {
  seconds: number
  at: number
}

export interface Records {
  version: number
  /** city number as a string key -> best clear time in seconds */
  cities: Record<string, number>
  /** completed full runs, fastest first */
  runs: RunRecord[]
}

const RECORDS_VERSION = 1

let memoryFallback: Records | null = null

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage
    if (!s) return null
    // named like the profile probe so nothing that looks like dev tooling ever
    // reaches the shipped bundle
    const probe = '__borderrun_records_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function emptyRecords(): Records {
  return { version: RECORDS_VERSION, cities: {}, runs: [] }
}

/** finite, in range, rounded to a tenth of a second — otherwise null */
function seconds(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > max) return null
  return Math.round(v * 10) / 10
}

/**
 * Rebuild a Records object from anything at all. Only integer keys inside the
 * city range survive, so a crafted payload cannot smuggle extra keys in.
 */
function sanitize(raw: unknown): Records {
  const out = emptyRecords()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const d = raw as Record<string, unknown>

  const rawCities = d.cities
  if (rawCities && typeof rawCities === 'object' && !Array.isArray(rawCities)) {
    const src = rawCities as Record<string, unknown>
    for (let city = 1; city <= MAX_CITY; city++) {
      const key = String(city)
      const t = seconds(src[key], MAX_CITY_SEC)
      if (t !== null) out.cities[key] = t
    }
  }

  const rawRuns = d.runs
  if (Array.isArray(rawRuns)) {
    for (const entry of rawRuns.slice(0, MAX_RUNS)) {
      if (!entry || typeof entry !== 'object') continue
      const r = entry as Record<string, unknown>
      const t = seconds(r.seconds, MAX_RUN_SEC)
      if (t === null) continue
      const at = typeof r.at === 'number' && Number.isFinite(r.at) ? Math.round(r.at) : 0
      out.runs.push({ seconds: t, at })
    }
    out.runs.sort((a, b) => a.seconds - b.seconds)
    out.runs = out.runs.slice(0, MAX_RUNS)
  }

  return out
}

export function loadRecords(): Records {
  const s = storage()
  if (!s) return memoryFallback ?? emptyRecords()
  let raw: string | null = null
  try {
    raw = s.getItem(RECORDS_KEY)
  } catch {
    return memoryFallback ?? emptyRecords()
  }
  if (!raw) return emptyRecords()
  if (raw.length > MAX_CHARS) {
    try {
      s.removeItem(RECORDS_KEY)
    } catch {
      /* ignore */
    }
    return emptyRecords()
  }
  try {
    return sanitize(JSON.parse(raw))
  } catch {
    return emptyRecords()
  }
}

export function saveRecords(r: Records): void {
  memoryFallback = r
  const s = storage()
  if (!s) return
  try {
    s.setItem(RECORDS_KEY, JSON.stringify(r))
  } catch {
    /* storage full or blocked: the in-memory copy still serves this session */
  }
}

/**
 * Note the time a city was cleared. Keeps the best (lowest) time only, so a
 * slow replay never erases a good record. Returns the stored best, or null when
 * the value was rejected outright.
 */
export function recordCityTime(city: number, sec: number): number | null {
  const t = seconds(sec, MAX_CITY_SEC)
  if (t === null) return null
  if (!Number.isInteger(city) || city < 1 || city > MAX_CITY) return null
  const r = loadRecords()
  const key = String(city)
  const prev = r.cities[key]
  if (prev === undefined || t < prev) {
    r.cities[key] = t
    saveRecords(r)
    return t
  }
  return prev
}

/** Note a full 100 city run finished in one sitting. */
export function recordRun(sec: number): void {
  const t = seconds(sec, MAX_RUN_SEC)
  if (t === null) return
  const r = loadRecords()
  r.runs.push({ seconds: t, at: Date.now() })
  r.runs.sort((a, b) => a.seconds - b.seconds)
  r.runs = r.runs.slice(0, MAX_RUNS)
  saveRecords(r)
}

export function clearRecords(): void {
  memoryFallback = null
  try {
    globalThis.localStorage?.removeItem(RECORDS_KEY)
  } catch {
    /* nothing we can do */
  }
}

/** how many cities have a recorded time */
export function timedCityCount(r: Records): number {
  return Object.keys(r.cities).length
}

/** format seconds as m:ss (or h:mm:ss past an hour) for the ranking tables */
export function fmtClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
