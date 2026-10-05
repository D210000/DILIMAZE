import { RNG } from './rng'
import type {
  Archetype,
  Clue,
  Guard,
  GuardRole,
  Prop,
  PropKind,
  Region,
  TileKind,
  Vec,
  World,
} from './types'

export const TS = 32 // tile size in px

/**
 * 5 regions x 20 cities = the 100 cities of the run.
 * "Neon dusk" palettes: glowing magenta/cyan cities you can actually see.
 * Everything sits in a readable mid-tone band — dark enough to glow, light
 * enough that roads, sidewalks, plazas and rooftops stay clearly distinct.
 * PLACEHOLDER: `hook` / `lore` are temp copy — swap in the real Dlicom text.
 */
export const CITIES_PER_REGION = 20

export const REGIONS: Region[] = [
  {
    id: 'fringe',
    name: 'Fringe Sector',
    hook: 'Where the wire starts. Cheap fences, cheaper informants.',
    lore: 'PLACEHOLDER LORE: The Fringe was the country\'s first server farm, then its first slum. The grid still hums under the asphalt, and the people who stayed learned to speak in static.',
    grass: '#2f2c58',
    road: '#525c9e',
    building: '#6a52b4',
    buildingAlt: '#45448a',
    accent: '#ff4fb0',
    neon: '#ff5cc0',
    neon2: '#4fe4ff',
  },
  {
    id: 'rustwater',
    name: 'Rustwater',
    hook: 'Flooded docks. Everything here is wet, lit, and watching.',
    lore: 'PLACEHOLDER LORE: Rustwater drowned twice and kept trading anyway. Barges run on stolen current, and every canal is a shortcut for someone who does not want to be seen.',
    grass: '#215160',
    road: '#3d7c8e',
    building: '#4aa3b2',
    buildingAlt: '#33697a',
    accent: '#2bffd0',
    neon: '#2bffd0',
    neon2: '#ff7cc8',
  },
  {
    id: 'glassgrid',
    name: 'Glassgrid',
    hook: 'Downtown. Towers, cameras, and no cheap way out.',
    lore: 'PLACEHOLDER LORE: The Grid sold its skyline to whoever could pay in light. Guards here wear visors tuned to pick a heartbeat out of a crowd.',
    grass: '#332e6b',
    road: '#5658ab',
    building: '#6f52c4',
    buildingAlt: '#4a4597',
    accent: '#c58cff',
    neon: '#c58cff',
    neon2: '#54e8ff',
  },
  {
    id: 'halcyon',
    name: 'Halcyon Heights',
    hook: 'Cold air, clean streets, a checkpoint every block.',
    lore: 'PLACEHOLDER LORE: Halcyon was built as the escape hatch for people who never had to run. The road out of it is the only one that never closes. It just costs everything.',
    grass: '#2b4568',
    road: '#4576a4',
    building: '#5b93c1',
    buildingAlt: '#3d6389',
    accent: '#54e8ff',
    neon: '#54e8ff',
    neon2: '#ff9ed4',
  },
  {
    id: 'lockdown',
    name: 'Lockdown Borderlands',
    hook: 'The last 20. Past the fence is another country.',
    lore: 'PLACEHOLDER LORE: The Borderlands are not a place so much as a countdown. The lights are red on purpose: they want you to see the finish and know you probably will not reach it.',
    grass: '#582f40',
    road: '#84485a',
    building: '#a5556b',
    buildingAlt: '#744051',
    accent: '#ff5470',
    neon: '#ff5470',
    neon2: '#ffd24a',
  },
]

export function regionIndexForCity(city: number): number {
  return Math.min(REGIONS.length - 1, Math.max(0, Math.floor((city - 1) / CITIES_PER_REGION)))
}

export function regionForCity(city: number): Region {
  return REGIONS[regionIndexForCity(city)]
}

/* ------------------------------------------------------------------ */
/* city types                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every five levels the city changes type entirely: a neon downtown, a timber
 * village, a forest of clearings, a chrome future city, a dust of ruins. The
 * type is not just colour — it changes how much of the map is built over, how
 * tall the blocks stand, how many trees grow between them, and what clutter
 * ends up on the pavement.
 */
export const CITIES_PER_TYPE = 5

export const ARCHETYPES: Archetype[] = [
  {
    id: 'metro',
    name: 'Neon Metro',
    blurb: 'dense blocks, lit glass, a corner on every street',
    build: 0.88,
    height: 1.18,
    trees: 1,
    palette: { grass: '#17192f', road: '#39436e', building: '#68428f', buildingAlt: '#302b5d' },
    neon: { accent: '#ff4fb0', neon: '#ff5cc0', neon2: '#4fe4ff' },
    blend: 0.88,
  },
  {
    id: 'village',
    name: 'Timber Village',
    blurb: 'low cottages, fences, dirt lanes and a lot of open ground',
    build: 0.55,
    height: 0.48,
    trees: 1.8,
    palette: { grass: '#3c5735', road: '#826744', building: '#bd9861', buildingAlt: '#73543b' },
    neon: { accent: '#ffb45c', neon: '#ffc46a', neon2: '#ff8f5c' },
    blend: 0.9,
  },
  {
    id: 'forest',
    name: 'Forest Clearings',
    blurb: 'deep cover, dirt tracks, very few walls to hide behind',
    build: 0.3,
    height: 0.58,
    trees: 4.8,
    palette: { grass: '#153e2b', road: '#48603b', building: '#416d49', buildingAlt: '#294c34' },
    neon: { accent: '#7dff9a', neon: '#6cff8c', neon2: '#d9ff6a' },
    blend: 0.94,
  },
  {
    id: 'future',
    name: 'Future City',
    blurb: 'glass towers, wide plazas and paper white light',
    build: 0.72,
    height: 1.8,
    trees: 0.35,
    palette: { grass: '#15323d', road: '#456978', building: '#81c0cb', buildingAlt: '#315a72' },
    neon: { accent: '#66f0ff', neon: '#7cf6ff', neon2: '#b98cff' },
    blend: 0.94,
  },
  {
    id: 'ruins',
    name: 'Rubble District',
    blurb: 'half the city is down, the other half is being emptied',
    build: 0.48,
    height: 0.76,
    trees: 0.9,
    palette: { grass: '#3c302b', road: '#70645a', building: '#82705a', buildingAlt: '#4d4038' },
    neon: { accent: '#ff8f5c', neon: '#ffa06a', neon2: '#ffd24a' },
    blend: 0.92,
  },
]

/**
 * The order of the types is rotated by region, so Region 2 does not open on the
 * same type Region 1 opened on: city 1 is a metro, city 21 is rubble.
 */
export function archetypeForCity(city: number): Archetype {
  const block = Math.floor((city - 1) / CITIES_PER_TYPE)
  const region = Math.floor((city - 1) / CITIES_PER_REGION)
  // A region is four five-level blocks wide, and the deck is dealt four at a
  // time: every region sees four of the five types with no repeat inside it, and
  // the turn of one type per region means City 1 and City 21 never match.
  const perRegion = CITIES_PER_REGION / CITIES_PER_TYPE
  return ARCHETYPES[(block % perRegion + region) % ARCHETYPES.length]
}

/**
 * What each type leaves lying in the street, as a weight on the base chance.
 * A village is fences and open ground, a forest is trees, a future city is clean
 * plazas with vending stalls, and rubble is crates and dumped rubbish.
 */
const STREET_BIAS: Record<Archetype['id'], Partial<Record<PropKind, number>>> = {
  metro: { tree: 1, crate: 1, fence: 1, dumpster: 1, trash: 1, coin: 1, stall: 1 },
  village: { tree: 1.7, crate: 0.4, fence: 3.2, dumpster: 0.35, trash: 0.6, coin: 1, stall: 0.5 },
  forest: { tree: 3.2, crate: 0.7, fence: 0.5, dumpster: 0.25, trash: 0.5, coin: 1, stall: 0.3 },
  future: { tree: 0.35, crate: 0.6, fence: 0.25, dumpster: 0.4, trash: 0.5, coin: 1.4, stall: 2.2 },
  ruins: { tree: 0.8, crate: 2, fence: 1.3, dumpster: 1.7, trash: 2.2, coin: 1, stall: 0.6 },
}

/* ------------------------------------------------------------------ */
/* colour                                                              */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255]
}

/** turn a colour round the wheel, keeping its saturation and brightness */
function rotateHue(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  const [r2, g2, b2] = hslToRgb(h + deg, s, l)
  return rgbToHex(r2, g2, b2)
}

/**
 * The palette one city is actually painted in: the region's colours, pulled
 * toward the city type, then nudged round the wheel by a drift that only this
 * city has. Two cities on the same street never look the same.
 */
export function paletteForCity(city: number): Region {
  const base = REGIONS[regionIndexForCity(city)]
  const type = archetypeForCity(city)
  // deterministic -27..27 degrees, and a little more saturation for the loud types
  const drift = (((city * 47) % 41) - 20) * 1.35
  const paint = (from: string, toward: string) => rotateHue(mixHex(from, toward, type.blend), drift)
  return {
    ...base,
    grass: paint(base.grass, type.palette.grass),
    road: paint(base.road, type.palette.road),
    building: paint(base.building, type.palette.building),
    buildingAlt: paint(base.buildingAlt, type.palette.buildingAlt),
    accent: paint(base.accent, type.neon.accent),
    neon: paint(base.neon, type.neon.neon),
    neon2: paint(base.neon2, type.neon.neon2),
  }
}

// Scaling curve helpers -------------------------------------------------

// every city is a little bigger than the last: 38x30 out of the gate, 84x66 by the border
export function mapSize(city: number): { w: number; h: number } {
  const w = Math.min(84, Math.round(38 + (city - 1) * 0.46))
  const h = Math.min(66, Math.round(30 + (city - 1) * 0.36))
  return { w, h }
}

// 2 clue links at City 1, growing to 9 by the end of the run
export function clueCount(city: number): number {
  return Math.min(9, 2 + Math.floor((city - 1) / 12))
}

/**
 * The opening-levels hand-hold. Only the first two clues of a chain, and only in
 * the first few cities, get pointed at: close-together landmarks, a direction and
 * distance in the riddle, the tracker arrow, and hint rings. Everything after
 * that has to be found from the riddle alone.
 */
export const CLUE_ASSIST_MAX_CITY = 5
export const CLUE_ASSIST_CLUES = 2

export function clueAssist(city: number, clueIndex: number): boolean {
  return city <= CLUE_ASSIST_MAX_CITY && clueIndex < CLUE_ASSIST_CLUES
}

/** "4 blocks north-east" — the early-game hand-hold */
function describeDirection(from: Vec, to: Vec): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const blocks = Math.max(1, Math.round(Math.hypot(dx, dy)))
  const ew = Math.abs(dx) < 3 ? '' : dx > 0 ? 'east' : 'west'
  const ns = Math.abs(dy) < 3 ? '' : dy > 0 ? 'south' : 'north'
  const dir = ns && ew ? `${ns}${ew}` : ns || ew || 'nearby'
  return `${blocks} block${blocks === 1 ? '' : 's'} ${dir}`
}

/* ------------------------------------------------------------------ */
/* clue locator hints                                                  */
/* ------------------------------------------------------------------ */

const LANDMARK_NAME: Partial<Record<PropKind, string>> = {
  board: 'notice board',
  bar: 'bar',
  kid: 'kid',
  radio: 'radio',
  graffiti: 'graffiti wall',
}

function landmarkName(kind: PropKind | 'border gate'): string {
  return kind === 'border gate' ? 'border gate' : LANDMARK_NAME[kind] ?? kind
}

/*
 * The locator line is the sentence the player reads on every single clue, so it
 * is built from three rotating parts (how far, which slice of the map, which
 * sentence shape) instead of one fixed template. A city runs long, and the next
 * city moves on again, so the same wording rarely shows up twice.
 */

const BAND_NEAR = ['Right on top of you', 'On your doorstep', 'Close enough to hear it']
const BAND_SHORT = ['A couple of streets away', 'Two or three turns away', 'A short walk at most']
const BAND_FAIR = ['A fair walk', 'A fair walk across a few streets', 'Halfway across the city', 'A long walk']
const BAND_FAR = ['Clear across the city', 'Far across the city', 'All the way on the far side']

/** never an exact distance — just "how far" in words */
function proximityBand(from: Vec, to: Vec, rng: RNG): string {
  const d = Math.hypot(to.x - from.x, to.y - from.y)
  if (d < 7) return rng.pick(BAND_NEAR)
  if (d < 16) return rng.pick(BAND_SHORT)
  if (d < 30) return rng.pick(BAND_FAIR)
  return rng.pick(BAND_FAR)
}

/** which slice of the map a point sits in — the coarse "where do I look" anchor */
function quarterOf(x: number, y: number, w: number, h: number, rng: RNG): string {
  const ew = x < w / 3 ? 'west' : x > (w * 2) / 3 ? 'east' : ''
  const ns = y < h / 3 ? 'north' : y > (h * 2) / 3 ? 'south' : ''
  if (ns && ew)
    return rng.pick([
      `the ${ns}${ew} of the city`,
      `the ${ns}${ew} corner of the city`,
      `the ${ns}${ew} quarter`,
    ])
  if (ns) return rng.pick([`the ${ns} side of the city`, `the ${ns} end of the city`, `the far ${ns}`])
  if (ew) return rng.pick([`the ${ew} side of the city`, `the ${ew} end of the city`, `the far ${ew}`])
  return rng.pick(['the dead centre of the city', 'the middle of the city', 'the centre of the city'])
}

/** the sentence shapes the locator can take: band + landmark + quarter */
const HINT_SHAPES: Array<(landmark: string, band: string, quarter: string) => string> = [
  (l, b, q) => `Hint: ${b}. The ${l} waits in ${q}.`,
  (l, b, q) => `Hint: ${b}, and the ${l} sits in ${q}.`,
  (l, b, q) => `Hint: the ${l} is in ${q}, ${b.toLowerCase()}.`,
  (l, b, q) => `Hint: ${q}. The ${l} is ${b.toLowerCase()}.`,
  (l, b, q) => `Next lead: ${q}, ${b.toLowerCase()} from here. Look for the ${l}.`,
]

/**
 * The plain-language locator handed to the player with every clue. The riddle
 * names the landmark; this says roughly where to walk so a City-40 chain is
 * findable without an arrow. Deliberately coarse — no exact block counts.
 */
function locatorHint(
  from: Vec,
  to: Vec,
  w: number,
  h: number,
  kind: PropKind | 'border gate',
  rng: RNG,
): string {
  const band = proximityBand(from, to, rng)
  const quarter = quarterOf(to.x, to.y, w, h, rng)
  return rng.pick(HINT_SHAPES)(landmarkName(kind), band, quarter)
}

/** the opener for the pre-chain line, so City 1 and City 90 do not read alike */
const ENTRY_SHAPES: Array<(landmark: string, band: string, quarter: string) => string> = [
  (l, b, q) => `First lead: ${b}. The ${l} waits in ${q}.`,
  (l, b, q) => `First lead: ${q}. The ${l} is ${b.toLowerCase()}.`,
  (l, b, q) => `First lead: ${b}, in ${q}. Look for the ${l}.`,
]

/* ------------------------------------------------------------------ */
/* solvability guarantee                                               */
/* ------------------------------------------------------------------ */

/** 1 = the player can stand here (props that need vaulting are passable) */
function passableGrid(world: World): Uint8Array {
  const g = new Uint8Array(world.w * world.h)
  for (let i = 0; i < world.tiles.length; i++) {
    const t = world.tiles[i]
    if (t === 'building' || t === 'water' || t === 'wall') g[i] = 1
  }
  for (const p of world.props) {
    if (!p.blocking || p.climbable || p.used) continue
    const tx = Math.floor(p.x / TS)
    const ty = Math.floor(p.y / TS)
    if (tx >= 0 && ty >= 0 && tx < world.w && ty < world.h) g[ty * world.w + tx] = 1
  }
  return g
}

/** 4-directional flood fill from a point; returns a visited mask */
function flood(world: World, from: Vec, blocked: Uint8Array): Uint8Array {
  const seen = new Uint8Array(world.w * world.h)
  const sx = Math.max(0, Math.min(world.w - 1, Math.floor(from.x)))
  const sy = Math.max(0, Math.min(world.h - 1, Math.floor(from.y)))
  const queue: number[] = []
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return
    const i = y * world.w + x
    if (seen[i] || blocked[i]) return
    seen[i] = 1
    queue.push(i)
  }
  seed(sx, sy)
  // if something is standing where we start, measure from the tiles around it
  // instead of declaring the whole city unreachable
  if (!queue.length) {
    seed(sx - 1, sy)
    seed(sx + 1, sy)
    seed(sx, sy - 1)
    seed(sx, sy + 1)
  }
  while (queue.length) {
    const idx = queue.pop()!
    const x = idx % world.w
    const y = (idx - x) / world.w
    if (x > 0) push(idx - 1)
    if (x < world.w - 1) push(idx + 1)
    if (y > 0) push(idx - world.w)
    if (y < world.h - 1) push(idx + world.w)
    function push(n: number) {
      if (!seen[n] && !blocked[n]) {
        seen[n] = 1
        queue.push(n)
      }
    }
  }
  return seen
}

/** a target is reachable if its own tile, or any tile touching it, is walkable */
function reachedTarget(world: World, seen: Uint8Array, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx
      const y = ty + dy
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue
      if (seen[y * world.w + x]) return true
    }
  return false
}

/** everything the player must be able to walk to: clue chain in order, then gate */
function targetsOf(world: World): Array<{ x: number; y: number; label: string }> {
  return [
    ...world.clues.map((c, i) => ({ x: Math.floor(c.x / TS), y: Math.floor(c.y / TS), label: `clue ${i + 1}` })),
    { x: world.w - 1, y: Math.floor(world.gate.y), label: 'border gate' },
  ]
}

/** read-only check: labels of every target the player cannot reach ([] = fine) */
export function blockedTargets(world: World): string[] {
  const seen = flood(world, world.spawn, passableGrid(world))
  return targetsOf(world)
    .filter((t) => !reachedTarget(world, seen, t.x, t.y))
    .map((t) => t.label)
}

/**
 * Always-solvable guarantee: nothing may wall the player off from the clue chain
 * or the border gate. Blocking props caught in a pocket around an unreachable
 * target are downgraded until a flood fill from the spawn point reaches it.
 * Returns how many props were downgraded (0 for a clean generation).
 */
export function ensureSolvable(world: World): number {
  let cleared = 0
  let carves = 0
  // 0. the spawn tile itself must be standable — the player starts there
  const sx = Math.floor(world.spawn.x)
  const sy = Math.floor(world.spawn.y)
  for (const p of world.props) {
    if (!p.blocking || p.climbable || p.used) continue
    if (Math.abs(p.x / TS - sx) <= 1 && Math.abs(p.y / TS - sy) <= 1) {
      p.blocking = false
      cleared++
    }
  }
  for (let attempt = 0; attempt < 24; attempt++) {
    const seen = flood(world, world.spawn, passableGrid(world))
    const bad = targetsOf(world).find((t) => !reachedTarget(world, seen, t.x, t.y))
    if (!bad) return cleared

    // 1. most cities are fixed by opening the pocket of props around the target.
    //    Start surgical and widen only if the target is still cut off.
    const radius = Math.min(4, 2 + Math.floor(attempt / 3))
    let changed = false
    for (const p of world.props) {
      if (!p.blocking || p.climbable || p.used) continue
      if (Math.abs(p.x / TS - bad.x) <= radius && Math.abs(p.y / TS - bad.y) <= radius) {
        p.blocking = false
        cleared++
        changed = true
      }
    }
    if (changed) continue

    // 2. otherwise the tiles themselves wall it off: carve a lane to the gate row
    if (carves < 3) {
      carves++
      const gateRow = Math.floor(world.gate.y)
      const cx = Math.max(0, Math.min(world.w - 1, bad.x))
      const y0 = Math.max(0, Math.min(gateRow, bad.y))
      const y1 = Math.min(world.h - 1, Math.max(gateRow, bad.y))
      for (let y = y0; y <= y1; y++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx
          if (x < 0 || x >= world.w) continue
          const i = y * world.w + x
          if (world.tiles[i] === 'building' || world.tiles[i] === 'wall') world.tiles[i] = 'sidewalk'
        }
      for (const p of world.props) {
        if (!p.blocking || p.climbable || p.used) continue
        const px = Math.floor(p.x / TS)
        const py = Math.floor(p.y / TS)
        if (Math.abs(px - cx) <= 1 && py >= y0 && py <= y1) {
          p.blocking = false
          cleared++
        }
      }
      continue
    }

    // 3. never reached in practice: nothing may block the route at all
    for (const p of world.props) {
      if (!p.climbable && p.blocking) {
        p.blocking = false
        cleared++
      }
    }
  }
  return cleared
}

/*
 * Guards climb one tier per region: a City 1 patrol is a light figure with a
 * short stare, a Lockdown enforcer is plated, quick and sees most of a street.
 * The tier is shared with the renderer, so the strength of a patrol and the way
 * it looks are always the same number.
 */
export const GUARD_TIERS = 5
export const GUARD_RANKS = ['patrol', 'sentry', 'warden', 'marshal', 'enforcer'] as const

export function guardTier(city: number): number {
  return Math.min(GUARD_TIERS - 1, regionIndexForCity(city))
}

/** the word the toasts and the manual use for a given guard */
export function guardRankName(gd: { tier: number; captain: boolean }): string {
  if (gd.captain) return 'captain'
  return GUARD_RANKS[Math.max(0, Math.min(GUARD_TIERS - 1, gd.tier))]
}

// More guards, wider cones and longer legs the further east you get. The patrol
// count climbs a step every four cities up to fifteen, and the per city speed
// rises too, but both stay below the runner's sprint: a chase is always
// answerable with a run or a hiding spot, never a hopeless footrace.
function guardSpec(city: number): { n: number; dist: number; half: number; speed: number; tier: number } {
  const n = Math.min(15, 3 + Math.floor((city - 1) / 4))
  const dist = Math.min(10, 4.4 + city * 0.056)
  const half = Math.min(0.66, 0.4 + city * 0.0026)
  const speed = Math.min(4.7, 1.5 + city * 0.032)
  return { n, dist, half, speed, tier: guardTier(city) }
}

/*
 * What each patrol brings on top of its rank. The opening cities are fighters
 * only; from City 6 the city starts fielding watchers, and from City 11 some of
 * the patrols carry a weapon and will shoot you from across a street. Dealt out
 * by index, so the roles stay mixed instead of leaving a city with no shooter at
 * all for no reason the player can see.
 */
const EARLY_ROLES: GuardRole[] = ['beat', 'wide', 'long', 'beat']
const FULL_ROLES: GuardRole[] = ['beat', 'wide', 'long', 'gun', 'beat', 'long', 'gun', 'wide']
const ELITE_ROLES: GuardRole[] = [
  'beat', 'wide', 'long', 'gun', 'tracker', 'charger', 'beat', 'long', 'gun', 'tracker', 'wide', 'charger',
]

export function guardRoleFor(city: number, index: number): GuardRole {
  if (city < 6) return 'beat'
  if (city < 11) return EARLY_ROLES[(index + city) % EARLY_ROLES.length]
  if (city >= 21) return ELITE_ROLES[(index + city) % ELITE_ROLES.length]
  return FULL_ROLES[(index + city) % FULL_ROLES.length]
}

/** how the role bends a guard's eyes and legs before a captain is layered on */
const ROLE_TRAITS: Record<GuardRole, { dist: number; half: number; speed: number }> = {
  beat: { dist: 1.05, half: 0.95, speed: 1.12 },
  long: { dist: 1.5, half: 0.72, speed: 0.92 },
  wide: { dist: 0.8, half: 1.6, speed: 0.96 },
  gun: { dist: 1.25, half: 0.9, speed: 0.95 },
  laser: { dist: 1.25, half: 0.82, speed: 0.86 },
  charger: { dist: 0.92, half: 0.88, speed: 1.02 },
  tracker: { dist: 1.15, half: 0.9, speed: 0.94 },
}

/*
 * Riddles. A city deals them out like cards, one per clue, so a chain never
 * says the same thing twice, and the deck is rotated by 17 per city, which is
 * wider than the longest chain, so two cities in a row cannot share a line
 * either. The shapes below are then filled from slot pools, so even a shape a
 * player has met before reads differently the next time it comes round.
 */
type RiddleShape = (next: string, gate: string, t: RNG) => string

const NEXT_THING = [
  'the next word',
  'the next line',
  'the next name',
  'the next lead',
  'the next slip of paper',
  'the next number',
]
const CARRIER = [
  'the courier',
  'the runner',
  'the night driver',
  'the woman from the docks',
  'the man with the case',
  'the kid on the bike',
]
const STAMP = ['the stamp', 'the mark', 'the seal', 'the border pass', 'the ledger', 'the token']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const RIDDLE_POOL: RiddleShape[] = [
  // shapes that set up the handover
  (n) => `Nothing is written down. Only ${n} remembers the next line.`,
  (n) => `Nobody at ${n} talks to strangers. Somebody there did once.`,
  (n, g) => `Follow the chain to ${n}... and when the chain ends, ${g} opens.`,
  (n) => `Whoever runs this city wrote the trail down at ${n}.`,
  (n) => `Two names left town this week. One of them was at ${n}.`,
  (n) => `The next line was spoken, not written, and it was spoken at ${n}.`,
  (n) => `Ask about the night bus at ${n}.`,
  (n) => `${n} holds the third letter, not the first.`,
  (n) => `They redraw these streets every season. ${n} never moves.`,
  (n) => `Do not knock. Wait at ${n}.`,
  (n) => `After dark the signal repeats from ${n}.`,
  (n) => `The chain is short and it runs through ${n}.`,
  (n) => `Somebody paid to have ${n} forgotten. Almost worked.`,
  (n) => `Write nothing down. Read everything at ${n}.`,
  (n) => `${n} is the only door that is still open tonight.`,
  (n) => `The last runner marked their name at ${n}.`,
  (n) => `Count the lights on the way to ${n}.`,
  (n) => `Whatever you were told in the last city, it ends up at ${n}.`,
  // slot shapes, filled from the pools above
  (n, _g, t) => `${cap(t.pick(NEXT_THING))} waits at ${n}.`,
  (n, _g, t) => `Ask ${n}. They saw ${t.pick(CARRIER)} pass.`,
  (n, _g, t) => `Rumor says ${t.pick(STAMP)} hides near ${n}.`,
  (n, _g, t) => `${n} keeps ${t.pick(NEXT_THING)} under the counter.`,
  (n, _g, t) => `${cap(t.pick(CARRIER))} stopped at ${n} and never came out.`,
  (n, _g, t) => `Painted over twice, and ${n} still carries ${t.pick(STAMP)}.`,
  (n, _g, t) => `${cap(t.pick(STAMP))} changed hands at ${n}.`,
  (n, _g, t) => `Ask about ${t.pick(CARRIER)} at ${n}.`,
  (n, _g, t) => `Only ${n} will say ${t.pick(NEXT_THING)} out loud.`,
  (n, _g, t) => `Wait at ${n} until ${t.pick(CARRIER)} passes.`,
  (n, _g, t) => `${cap(t.pick(STAMP))} was last seen at ${n}.`,
  (n, _g, t) => `${n} is where the trail bends. ${cap(t.pick(STAMP))} goes with it.`,
  (n, _g, t) => `Two streets past the noise, ${n} keeps ${t.pick(STAMP)}.`,
  (n, g, t) => `${cap(t.pick(STAMP))} left ${n} heading for ${g}, and ${g} does not open for free.`,
  (n, _g, t) => `${n} is where ${t.pick(CARRIER)} dropped ${t.pick(NEXT_THING)}.`,
  (n, _g, t) => `Follow ${t.pick(CARRIER)} as far as ${n}. Then stop.`,
  // two slot shapes: the same line reads differently for a long while yet
  (n, _g, t) => `${cap(t.pick(CARRIER))} carried ${t.pick(STAMP)} through ${n} last night.`,
  (n, _g, t) => `Ask for ${t.pick(CARRIER)} at ${n}, then ask about ${t.pick(NEXT_THING)}.`,
  (n, _g, t) => `${cap(t.pick(STAMP))} and ${t.pick(NEXT_THING)} were both left at ${n}.`,
  (n, _g, t) => `${n} saw ${t.pick(CARRIER)} and kept ${t.pick(STAMP)}.`,
  (n, _g, t) => `${cap(t.pick(NEXT_THING))} came through ${n} with ${t.pick(STAMP)}.`,
  (n, g, t) => `${cap(t.pick(CARRIER))} left ${t.pick(STAMP)} at ${n} and went on to ${g}.`,
]

/** how far the deck turns between one city and the next */
const RIDDLE_STEP = 17

/**
 * Riddles may call a landmark by one of a few names, so a shape the player has
 * met before still reads as a new sentence. The locator hint keeps the plain
 * name, so the two lines still obviously point at the same thing.
 */
const LANDMARK_ASIDES: Partial<Record<PropKind, string[]>> = {
  board: ['the notice board', 'the board', 'the posting board'],
  bar: ['the bar', 'the back bar', 'the corner bar'],
  kid: ['the kid', 'the local kid', 'the kid on the bike'],
  radio: ['the radio', 'the old radio', 'the radio set'],
  graffiti: ['the graffiti wall', 'the painted wall', 'the tagged wall'],
}

/** the closing riddle, worded a few ways so the last link does not read the same */
const GATE_RIDDLES: Array<(gate: string) => string> = [
  (g) => `End of the trail: ${g} sits on the east edge of the city. The stamp opens it.`,
  (g) => `The chain stops at ${g}, on the east edge. Only the stamp opens it.`,
  (g) => `Last line: ${g}, east edge of the city. Show the stamp and it opens.`,
  (g) => `Everything above this line was the walk. ${g} is the door, east edge, stamp only.`,
  (g) => `The trail ends where the city does: ${g}, east side. Bring the stamp.`,
]

export function generateCity(city: number, opts: { skipSolvabilityGuard?: boolean } = {}): World {
  const rng = new RNG(city * 7919 + 13)
  // Wording draws from its own stream: riddles and hints are not entangled with
  // the map, prop and patrol draws, so the copy can be reworded on its own.
  const text = new RNG(city * 104729 + 7)
  const { w, h } = mapSize(city)
  /** west-edge entry row === east-edge exit row */
  const gateRow = Math.floor(h / 2)
  const tiles: TileKind[] = new Array(w * h).fill('grass' as TileKind)
  const idx = (x: number, y: number) => y * w + x

  // street grid: vertical + horizontal roads every 6-9 tiles
  const vRoads: number[] = []
  for (let x = rng.int(4, 7); x < w - 3; x += rng.int(6, 9)) vRoads.push(x)
  const hRoads: number[] = []
  for (let y = rng.int(4, 7); y < h - 3; y += rng.int(6, 9)) hRoads.push(y)

  const setTile = (x: number, y: number, t: TileKind) => {
    if (x >= 0 && y >= 0 && x < w && y < h) tiles[idx(x, y)] = t
  }
  const getTile = (x: number, y: number): TileKind =>
    x >= 0 && y >= 0 && x < w && y < h ? tiles[idx(x, y)] : 'building'

  const paintRoad = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = getTile(x + dx, y + dy)
        if (t !== 'building') setTile(x + dx, y + dy, 'road')
      }
  }
  for (const x of vRoads) for (let y = 0; y < h; y++) paintRoad(x, y)
  for (const y of hRoads) for (let x = 0; x < w; x++) paintRoad(x, y)

  // sidewalk ring around roads
  const sidewalkify = () => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (tiles[idx(x, y)] !== 'grass') continue
        let near = false
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1 && !near; dx++)
            if (getTile(x + dx, y + dy) === 'road') near = true
        if (near) tiles[idx(x, y)] = 'sidewalk'
      }
  }
  sidewalkify()

  // fill blocks between roads: the city type decides how much of the space is
  // built over. A metro is nearly all blocks; a forest is mostly clearings.
  const type = archetypeForCity(city)
  const openChance = Math.min(0.8, Math.max(0.12, 1 - type.build))
  const parkShare = Math.min(0.85, 0.35 + (type.trees - 1) * 0.22)
  const plazaCellCenter = (point: number, roads: number[], max: number) => {
    let left = 2
    let right = max - 3
    for (const road of roads) {
      if (road < point) left = road + 3
      else {
        right = road - 3
        break
      }
    }
    return (left + right) / 2
  }
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (tiles[idx(x, y)] !== 'grass') continue
      // Future districts reserve a small civic court in the middle of each
      // superblock. This creates broad, walkable plaza shapes instead of a
      // random checkerboard of isolated open tiles between the towers.
      if (
        type.id === 'future' &&
        Math.abs(x - plazaCellCenter(x, vRoads, w)) <= 1 &&
        Math.abs(y - plazaCellCenter(y, hRoads, h)) <= 1
      ) {
        tiles[idx(x, y)] = 'plaza'
        continue
      }
      if (rng.chance(openChance)) {
        tiles[idx(x, y)] = rng.chance(parkShare) ? 'park' : 'plaza'
        continue
      }
      tiles[idx(x, y)] = 'building'
    }

  /* ---- a pond at a crossroads ----------------------------------------
   * Where a vertical and a horizontal street cross, drop a small square of
   * water in the middle. The roads are three tiles wide, so the outer lane and
   * the paving beyond it stay open: a walkable ring remains all round the pond
   * and the four arms still meet, so the clue flood fill is never cut. Pond
   * draws come from their own RNG so the map and prop streams are untouched. */
  const pondRng = new RNG(city * 6151 + 41)
  const roadAt = (x: number, y: number) => getTile(x, y) === 'road'
  const spots: Array<{ x: number; y: number }> = []
  for (const vx of vRoads)
    for (const hy of hRoads) {
      if (vx < 5 || hy < 5 || vx > w - 6 || hy > h - 6) continue
      if (roadAt(vx, hy) && roadAt(vx, hy - 3) && roadAt(vx, hy + 3) && roadAt(vx - 3, hy) && roadAt(vx + 3, hy))
        spots.push({ x: vx, y: hy })
    }
  pondRng.shuffle(spots)
  const pondCount = spots.length ? (spots.length > 1 && pondRng.chance(0.5) ? 2 : 1) : 0
  for (let i = 0; i < pondCount; i++) {
    const s = spots[i]
    let clear = true
    for (let dy = -2; dy <= 2 && clear; dy++)
      for (let dx = -2; dx <= 2 && clear; dx++) {
        const t = getTile(s.x + dx, s.y + dy)
        if (t !== 'road' && t !== 'sidewalk' && t !== 'plaza') clear = false
      }
    if (!clear) continue
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) setTile(s.x + dx, s.y + dy, 'water')
    // stone kerb ring, so the pond reads as a feature against the paving
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue
        const t = getTile(s.x + dx, s.y + dy)
        if (t === 'road' || t === 'plaza') setTile(s.x + dx, s.y + dy, 'sidewalk')
      }
  }

  const props: Prop[] = []
  let propId = 1
  /** 1 = tile already holds a prop (or can't be walked on at all) */
  const occupancy = new Uint8Array(w * h)
  for (let i = 0; i < occupancy.length; i++) {
    const t = tiles[i]
    if (t === 'building' || t === 'water' || t === 'wall') occupancy[i] = 1
  }
  /**
   * The player walks in at the west edge and leaves through the east gate, so
   * nothing may be built on those tiles or their neighbours: no spawning inside
   * a stall, no barricaded exit.
   */
  const reserve = (rx: number, ry: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx
        const y = ry + dy
        if (x >= 0 && y >= 0 && x < w && y < h) occupancy[idx(x, y)] = 1
      }
  }
  reserve(1, gateRow)
  reserve(w - 1, gateRow)
  const occAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : occupancy[idx(x, y)])

  const addProp = (
    kind: PropKind,
    tx: number,
    ty: number,
    extra?: Partial<Prop>,
  ): Prop => {
    const p: Prop = {
      id: propId++,
      kind,
      x: tx * TS + TS / 2,
      y: ty * TS + TS / 2,
      blocking: true,
      climbable: false,
      hide: false,
      used: false,
      ...extra,
    }
    props.push(p)
    occupancy[idx(tx, ty)] = 1
    return p
  }

  const walkable = (t: TileKind) =>
    t === 'road' || t === 'sidewalk' || t === 'plaza' || t === 'park'

  const freeSpotNear = (tx: number, ty: number): Vec | null => {
    for (let r = 1; r < 8; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = tx + dx
          const y = ty + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          if (!walkable(getTile(x, y))) continue
          if (occupancy[idx(x, y)]) continue
          return { x, y }
        }
    return null
  }

  /**
   * Would a blocking prop here leave the tile with fewer than two ways out?
   * Cheap anti-dead-end rule: decorative clutter is never allowed to seal a
   * pocket, which is what used to force the solvability pass to clean up after
   * the generator.
   */
  const wouldSeal = (x: number, y: number) => {
    let ways = 0
    if (!occAt(x - 1, y)) ways++
    if (!occAt(x + 1, y)) ways++
    if (!occAt(x, y - 1)) ways++
    if (!occAt(x, y + 1)) ways++
    return ways < 2
  }

  /**
   * A fountain wants to stand beside a block or under a tree, with a clear ring
   * around it: not jammed against a wall, not shoulder to shoulder with clutter.
   */
  // A fountain is a landmark: it sits beside a block or under a tree, with room
  // to breathe. A tree is a neighbour rather than clutter, so canopies never
  // count as crowding and a fountain never crowds a tree.
  const besideBlock = (x: number, y: number) =>
    getTile(x - 1, y) === 'building' ||
    getTile(x + 1, y) === 'building' ||
    getTile(x, y - 1) === 'building' ||
    getTile(x, y + 1) === 'building'
  const treeNear = (x: number, y: number) =>
    props.some(
      (p) =>
        p.kind === 'tree' &&
        Math.abs(p.x / TS - (x + 0.5)) <= 2.5 &&
        Math.abs(p.y / TS - (y + 0.5)) <= 2.5,
    )
  const fountainCrowded = (x: number, y: number, skip?: number) =>
    props.some(
      (p) =>
        p.id !== skip &&
        p.kind !== 'tree' &&
        Math.abs(p.x / TS - (x + 0.5)) <= 1.4 &&
        Math.abs(p.y / TS - (y + 0.5)) <= 1.4,
    )
  const fountainSpotOk = (x: number, y: number) =>
    (besideBlock(x, y) || treeNear(x, y)) && !fountainCrowded(x, y)
  // the closest free footpath tile: where a companion tree for a fountain grows
  const sidewalkNear = (x: number, y: number): { x: number; y: number } | null => {
    // two tiles is the limit: that is what keeps the companion tree inside the
    // "beside a block or under a tree" rule the self-test measures
    for (let r = 1; r <= 2; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) < r && Math.abs(dy) < r) continue
          const nx = x + dx
          const ny = y + dy
          if (getTile(nx, ny) !== 'sidewalk') continue
          if (occupancy[ny * w + nx]) continue
          return { x: nx, y: ny }
        }
    return null
  }

  // scatter decor + interactables on walkable tiles
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const t = tiles[idx(x, y)]
      if (!walkable(t)) continue
      if (occupancy[idx(x, y)]) continue

      // vaultable props (crate / fence / dumpster) can always be crossed, so
      // only truly solid decor has to respect the anti-seal rule
      const place = (kind: PropKind, extra?: Partial<Prop>) => {
        const opts = extra ?? {}
        const solid = opts.blocking !== false && opts.climbable !== true
        if (solid && wouldSeal(x, y)) return null
        return addProp(kind, x, y, extra)
      }

      const r = rng.next()
      if (t === 'park') {
        // green space is cover and seating — trees belong on the footpaths, so a
        // park grows shrubs and benches and never a stray trunk in the lawn
        const bushP = Math.min(0.6, 0.22 * type.trees)
        if (r < bushP) place('bush', { blocking: false, hide: true })
        else if (r < bushP + 0.08) place('bench', { blocking: false })
        continue
      }
      if (t === 'plaza' && r < 0.06 && fountainSpotOk(x, y)) {
        place('fountain')
        continue
      }
      if (t === 'sidewalk' || t === 'road') {
        // what gets left lying in the street is the city type talking
        const w = STREET_BIAS[type.id]
        // trees line the footpaths and only the footpaths: never the roadway and
        // never the open park, so a canopy always frames a kerb
        if (t === 'sidewalk' && r < 0.03 * (w.tree ?? 1)) {
          place('tree', { blocking: false })
          continue
        }
        const table: Array<[PropKind, Partial<Prop> | undefined, number]> = [
          ['crate', { climbable: true }, 0.02 * (w.crate ?? 1)],
          ['fence', { climbable: true }, 0.015 * (w.fence ?? 1)],
          ['dumpster', { climbable: true, hide: true }, 0.01 * (w.dumpster ?? 1)],
          ['trash', { blocking: false }, 0.015 * (w.trash ?? 1)],
          ['coin', { blocking: false }, 0.01 * (w.coin ?? 1)],
          ['stall', undefined, 0.01 * (w.stall ?? 1)],
        ]
        let mark = 0
        for (const [kind, extra, chance] of table) {
          mark += chance
          if (r < mark) {
            place(kind, extra)
            break
          }
        }
      }
    }

  // guarantee a fountain, and prefer one that sits well: a plaza tile beside a
  // block or a tree, with room around it, as close to the middle as we can get
  if (!props.some((p) => p.kind === 'fountain')) {
    const mx = Math.floor(w / 2)
    const my = Math.floor(h / 2)
    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        if (getTile(x, y) !== 'plaza') continue
        if (occupancy[idx(x, y)]) continue
        if (!fountainSpotOk(x, y)) continue
        const d = Math.abs(x - mx) + Math.abs(y - my)
        if (d < bestD) {
          bestD = d
          best = { x, y }
        }
      }
    // A sparse archetype can have every central plaza claimed by furniture.
    // Search the whole walkable city for the same landmark conditions before
    // falling back to a generic free tile, so the guaranteed fountain still
    // has its intended block-or-tree setting.
    if (!best) {
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          if (!walkable(getTile(x, y)) || occupancy[idx(x, y)] || !fountainSpotOk(x, y)) continue
          const d = Math.abs(x - mx) + Math.abs(y - my)
          if (d < bestD) {
            bestD = d
            best = { x, y }
          }
        }
    }
    const spot = best ?? freeSpotNear(mx, my) ?? { x: 2, y: 2 }
    addProp('fountain', spot.x, spot.y)
  }

  // guarantee cover: hiding from a guard's cone is a survival mechanic, so no
  // city may be generated without somewhere to duck into
  for (let i = 0, hides = props.filter((p) => p.hide).length; hides < 3 && i < 40; i++) {
    const spot = freeSpotNear(rng.int(3, w - 4), rng.int(3, h - 4))
    if (!spot) continue
    addProp('bush', spot.x, spot.y, { blocking: false, hide: true })
    hides++
  }

  // landmarks / services near road corners
  const cornerSpots: Vec[] = []
  for (const vx of vRoads)
    for (const hy of hRoads) {
      const s = freeSpotNear(vx + 2, hy + 2)
      if (s) cornerSpots.push(s)
    }
  rng.shuffle(cornerSpots)

  /**
   * A corner spot when one is left, otherwise any free walkable tile — never a
   * blind random tile, which could land a landmark inside a building block.
   */
  const takeSpot = (): Vec => {
    const spot = cornerSpots.pop()
    if (spot) return spot
    for (let tries = 0; tries < 120; tries++) {
      const x = rng.int(2, w - 3)
      const y = rng.int(2, h - 3)
      if (walkable(getTile(x, y)) && !occupancy[idx(x, y)]) return { x, y }
    }
    return { x: Math.floor(w / 2), y: Math.floor(h / 2) }
  }

  const shops = Math.max(1, Math.round((2 + Math.floor(city / 25)) * (type.id === 'future' ? 1.8 : type.id === 'forest' ? 0.6 : 1)))
  for (let i = 0; i < shops; i++) {
    const s = takeSpot()
    addProp('shop', s.x, s.y, { data: rng.chance(0.5) ? 'food' : 'water' })
  }

  // villages are built out of houses; forests barely have any
  const houses = Math.max(1, Math.round((2 + Math.floor(city / 20)) * (type.id === 'village' ? 2.4 : type.id === 'forest' ? 0.5 : 1)))
  for (let i = 0; i < houses; i++) {
    const s = takeSpot()
    addProp('house', s.x, s.y, { data: rng.chance(0.6) ? 'food' : 'water', blocking: false })
  }
  // clue-capable landmarks scale with the city, since later cities chain more clues
  for (let i = 0; i < 3 + Math.floor(city / 12); i++) {
    const s = takeSpot()
    addProp('bar', s.x, s.y)
  }
  for (let i = 0; i < 3 + Math.floor(city / 12); i++) {
    const s = takeSpot()
    addProp('board', s.x, s.y)
  }
  for (let i = 0; i < 3 + Math.floor(city / 25); i++) {
    const s = takeSpot()
    addProp('kid', s.x, s.y, { blocking: false })
  }
  for (let i = 0; i < 3 + Math.floor(city / 25); i++) {
    const s = takeSpot()
    addProp('radio', s.x, s.y)
  }
  for (let i = 0; i < 4 + Math.floor(city / 20); i++) {
    const s = takeSpot()
    addProp('graffiti', s.x, s.y, { blocking: false })
  }
  // safehouse benches in quiet corners
  for (let i = 0; i < 4 + Math.floor(city / 15); i++) {
    const s = takeSpot()
    addProp('bench', s.x, s.y, { blocking: false, data: 'sleep' })
  }
  // water tower = high-value loot, hard to reach (fenced)
  const wt = takeSpot()
  addProp('waterTower', wt.x, wt.y)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const s = freeSpotNear(wt.x + dx, wt.y + dy)
    if (s) addProp('fence', s.x, s.y, { climbable: true })
  }

  // Life crates are rare supplies: early cities can hold up to four, mid-run
  // cities up to two, and deep cities only one. The chance also falls by level,
  // so some cities have no life crate at all.
  const lifeLoot = new RNG(city * 7919 + 104729)
  const lifeCrateChance = Math.max(0.12, 0.72 - city * 0.012)
  const maxLifeCratesPerCity = 4
  const lifeCrateMax = Math.min(maxLifeCratesPerCity, city <= 20 ? 4 : city <= 50 ? 2 : 1)
  if (lifeLoot.chance(lifeCrateChance)) {
    const count = lifeLoot.int(1, lifeCrateMax)
    for (let i = 0; i < count; i++) {
      const spot = takeSpot()
      addProp('crate', spot.x, spot.y, { climbable: true, data: 'life' })
    }
  }

  // spawn: left edge; gate: right edge, carve a road to it
  const spawn = { x: 1.5, y: gateRow + 0.5 }
  const gateY = gateRow
  for (let x = 0; x < w; x++) {
    for (let dy = -1; dy <= 1; dy++) {
      const t = getTile(x, gateY + dy)
      if (t === 'building') tiles[idx(x, gateY + dy)] = 'sidewalk'
    }
  }
  const gate = { x: w - 1, y: gateY + 0.5 }

  // clue chain — must be reachable & ordered; anchor landmarks in sequence
  const nClues = clueCount(city)
  const chainKinds: PropKind[] = rng.shuffle(['board', 'bar', 'kid', 'radio', 'graffiti'] as PropKind[])
  const clues: Clue[] = []
  const used = new Set<number>()
  for (let i = 0; i < nClues; i++) {
    const kind = chainKinds[i % chainKinds.length]
    // find a prop of that kind not yet used, closest to previous clue for a short first hop
    const candidates = props.filter((p) => p.kind === kind && !used.has(p.id))
    if (candidates.length === 0) continue
    const prev = clues.length
      ? { x: clues[clues.length - 1].x, y: clues[clues.length - 1].y }
      : spawn
    candidates.sort(
      (a, b) => (a.x - prev.x) ** 2 + (a.y - prev.y) ** 2 - ((b.x - prev.x) ** 2 + (b.y - prev.y) ** 2),
    )
    // the assisted opening clues sit right next to the last one; everything after
    // is picked from the nearest few, so the chain scatters across the city
    const chosen = clueAssist(city, i)
      ? candidates[0]
      : candidates[rng.int(0, Math.min(3, candidates.length - 1))]
    used.add(chosen.id)
    chosen.data = 'clue'
    clues.push({
      propId: chosen.id,
      x: chosen.x,
      y: chosen.y,
      riddle: '',
      hint: '',
      puzzle: null,
    })
  }

  // riddles point to the next clue's landmark; final one points to the gate.
  // Only the assisted opening clues say which way and how far — but every clue
  // also carries a plain-language locator, so a 9-link chain stays findable.
  const gateName = 'the border gate'
  // deal the riddle shapes out like cards: the deck turns by RIDDLE_STEP each
  // city, which is wider than the longest chain, so no line repeats inside a
  // city and no two cities in a row share one either
  const riddleAt = (i: number) => RIDDLE_POOL[(city * RIDDLE_STEP + i) % RIDDLE_POOL.length]
  for (let i = 0; i < clues.length; i++) {
    const from: Vec = i === 0 ? spawn : { x: clues[i - 1].x / TS, y: clues[i - 1].y / TS }
    const nextClue = i + 1 < clues.length ? clues[i + 1] : null
    const kind: PropKind | 'border gate' = nextClue
      ? props.find((p) => p.id === nextClue.propId)!.kind
      : 'border gate'
    const target: Vec = nextClue ? { x: nextClue.x / TS, y: nextClue.y / TS } : { x: w - 1, y: gateY + 0.5 }
    if (!nextClue) {
      // the last lead is the gate itself, which deserves its own line, and the
      // wording turns with the city so neighbours never end on the same note
      clues[i].riddle = GATE_RIDDLES[city % GATE_RIDDLES.length](gateName)
    } else {
      const aside = kind === 'border gate' ? `the ${landmarkName(kind)}` : text.pick(LANDMARK_ASIDES[kind] ?? [`the ${landmarkName(kind)}`])
      const landmark = clueAssist(city, i + 1)
        ? `${aside} (${describeDirection(from, target)})`
        : aside
      clues[i].riddle = riddleAt(i)(landmark, gateName, text)
    }
    clues[i].hint = locatorHint(from, target, w, h, kind, text)
  }

  // where the very first clue is, for the scrambled-signal stretch at the start
  const firstClue = clues[0]
  const firstKind = firstClue ? props.find((p) => p.id === firstClue.propId)?.kind ?? 'board' : 'board'
  const entryHint = firstClue
    ? text.pick(ENTRY_SHAPES)(
        landmarkName(firstKind),
        proximityBand(spawn, { x: firstClue.x / TS, y: firstClue.y / TS }, text),
        quarterOf(firstClue.x / TS, firstClue.y / TS, w, h, text),
      )
    : ''

  // puzzles start appearing from city 4, one per extra clue
  if (city >= 4) {
    for (let i = 0; i < clues.length; i++) {
      if (i === 0) continue // first clue always free
      clues[i].puzzle = makePuzzle(rng, city)
    }
  }

  // guards
  const spec = guardSpec(city)
  const guards: Guard[] = []
  for (let i = 0; i < spec.n; i++) {
    // every third patrol is led by a captain: a tier up, a wider stare, a
    // heavier step, and gold on the helmet so you can pick them out at a glance
    const captain = spec.n >= 3 && i % 3 === 2
    const tier = Math.min(GUARD_TIERS - 1, spec.tier + (captain ? 1 : 0))
    const path: Vec[] = []
    // Does the straight line between two tiles stay on ground a guard can
    // cross? A patrol walks hip to hip between stops rather than pathfinding, so
    // any leg that clips a building used to leave the guard grinding at a wall.
    const legClear = (ax: number, ay: number, bx: number, by: number): boolean => {
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2))
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const x = Math.floor(ax + (bx - ax) * t + 0.5)
        const y = Math.floor(ay + (by - ay) * t + 0.5)
        if (x < 0 || y < 0 || x >= w || y >= h) return false
        if (!walkable(getTile(x, y))) return false
        const px = (ax + (bx - ax) * t) * TS
        const py = (ay + (by - ay) * t) * TS
        if (props.some((p) => p.blocking && !p.used && Math.abs(p.x - px) < 17 && Math.abs(p.y - py) < 17)) return false
      }
      return true
    }
    const anchor = cornerSpots.length
      ? cornerSpots[rng.int(0, cornerSpots.length - 1)]
      : { x: rng.int(4, w - 5), y: rng.int(4, h - 5) }
    let cx = Math.floor(anchor.x)
    let cy = Math.floor(anchor.y)
    // the route has to start somewhere a guard can actually stand
    if (cx < 0 || cy < 0 || cx >= w || cy >= h || !walkable(getTile(cx, cy))) {
      const near = freeSpotNear(cx, cy)
      if (near) {
        cx = near.x
        cy = near.y
      }
    }
    const guardCanStand = (x: number, y: number) =>
      walkable(getTile(x, y)) &&
      !props.some((p) => p.blocking && !p.used && Math.abs(p.x - (x + 0.5) * TS) < 17 && Math.abs(p.y - (y + 0.5) * TS) < 17)
    if (!guardCanStand(cx, cy)) {
      let nearest: { x: number; y: number; d: number } | null = null
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!guardCanStand(x, y)) continue
        const d = (x - cx) ** 2 + (y - cy) ** 2
        if (!nearest || d < nearest.d) nearest = { x, y, d }
      }
      if (nearest) { cx = nearest.x; cy = nearest.y }
    }
    const nodes = rng.int(3, 5)
    for (let k = 0; k < nodes; k++) {
      // hop to a nearby road tile whose whole leg stays clear of buildings
      for (let tries = 0; tries < 60; tries++) {
        const nx = cx + rng.int(-6, 6)
        const ny = cy + rng.int(-6, 6)
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if (!walkable(getTile(nx, ny))) continue
        if (!guardCanStand(nx, ny)) continue
        if (!legClear(cx, cy, nx, ny)) continue
        path.push({ x: nx + 0.5, y: ny + 0.5 })
        cx = nx
        cy = ny
        break
      }
    }
    if (path.length === 0) path.push({ x: cx + 0.5, y: cy + 0.5 })      // the role bends the eyes and legs before the captain bonus is layered on,
      // and the result is capped just under the runner's sprint (5.6 tiles/s)
      // even through the night bonus, so nobody can be outrun only by running.
      // High lockdown cities field two oversized laser captains among the
      // regular elite patrol mix, so players can read and plan around them.
      const role: GuardRole = city >= 50 && captain && i % 12 === 2 ? 'laser' : guardRoleFor(city, i)
      const traits = ROLE_TRAITS[role]
      const speed = Math.min(4.9, spec.speed * traits.speed * (captain ? 1.12 : 1))
      guards.push({
      id: i,
      // Patrol nodes are stored in tile units; live guard coordinates are pixels.
      x: path[0].x * TS,
      y: path[0].y * TS,
      path,
      wp: 1 % path.length,
      speed,
      state: 'patrol',
      alert: 0,
      dir: rng.float(0, Math.PI * 2),
      lastSeen: null,
      searchTimer: 0,
      visionDist: Math.min(
        role === 'gun' || role === 'laser' ? 18 * TS : 13 * TS,
        spec.dist * traits.dist * TS * (captain ? 1.08 : 1) * (role === 'laser' ? 1.55 : role === 'gun' ? 1.35 : 1),
      ),
      visionHalfAngle: Math.min(1.1, spec.half * traits.half * (captain ? 1.06 : 1)),
      stuckTimer: 0,
      detourPath: [],
      detourWp: 0,
      detourTarget: null,
      tier,
      role,
      captain,
      attackCd: 0,
      abilityCd: rng.float(0.5, 2.5),
      burstTimer: 0,
      flash: 0,
      shotAt: null,
    })
  }

  // Final tidy, once every prop is down: a fountain ends beside a block or
  // under a tree and never jammed against a shop door. Anything placed after
  // the fountain itself can have crowded it, so the rule is enforced here. A
  // lonely fountain gets a tree planted on the nearest free footpath, which is
  // what makes it read as a landmark rather than a stray basin.
  for (const f of props) {
    if (f.kind !== 'fountain') continue
    let tx = Math.floor(f.x / TS)
    let ty = Math.floor(f.y / TS)
    if (fountainCrowded(tx, ty, f.id)) {
      // prefer paving, but a fountain that cannot find a clear plaza tile is
      // better on the kerb than wedged against a stall
      for (const wantPlaza of [true, false]) {
        let moved = false
        for (let r = 2; r <= 8 && !moved; r++)
          for (let dy = -r; dy <= r && !moved; dy++)
            for (let dx = -r; dx <= r && !moved; dx++) {
              if (Math.abs(dx) < r && Math.abs(dy) < r) continue
              const nx = tx + dx
              const ny = ty + dy
              if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue
              const t2 = getTile(nx, ny)
              if (wantPlaza ? t2 !== 'plaza' : !walkable(t2)) continue
              if (occupancy[ny * w + nx]) continue
              if (fountainCrowded(nx, ny, f.id) || (!besideBlock(nx, ny) && !treeNear(nx, ny))) continue
              occupancy[ty * w + tx] = 0
              f.x = (nx + 0.5) * TS
              f.y = (ny + 0.5) * TS
              occupancy[ny * w + nx] = 1
              tx = nx
              ty = ny
              moved = true
            }
        if (moved) break
      }
      // still hemmed in? then the clutter steps aside instead: a bin, a shrub or
      // a coin lying in the square is decoration, and none of it is worth
      // spoiling the one landmark in the city for
      for (const other of props) {
        if (other.id === f.id || other.kind === 'tree' || other.blocking) continue
        if (Math.abs(other.x - f.x) > 1.4 * TS || Math.abs(other.y - f.y) > 1.4 * TS) continue
        const ox = Math.floor(other.x / TS)
        const oy = Math.floor(other.y / TS)
        search: for (let r = 1; r <= 4; r++)
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) < r && Math.abs(dy) < r) continue
              const nx = ox + dx
              const ny = oy + dy
              if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue
              if (occupancy[ny * w + nx] || !walkable(getTile(nx, ny))) continue
              const px = (nx + 0.5) * TS
              const py = (ny + 0.5) * TS
              if (Math.abs(px - f.x) <= 1.6 * TS && Math.abs(py - f.y) <= 1.6 * TS) continue
              occupancy[oy * w + ox] = 0
              other.x = px
              other.y = py
              occupancy[ny * w + nx] = 1
              break search
            }
      }
    }
    if (besideBlock(tx, ty) || treeNear(tx, ty)) continue
    const t = sidewalkNear(tx, ty)
    if (t) addProp('tree', t.x, t.y, { blocking: false })
  }

  const propAt = new Map<number, Prop>()
  for (const p of props) propAt.set(p.id, p)

  // difficulty: drain per in-game hour (day = 24h compressed)
  const drainBase = 1 + city * 0.012
  const world: World = {
    city,
    w,
    h,
    tiles,
    props,
    propAt,
    spawn,
    gate,
    entryHint,
    clues,
    guards,
    region: paletteForCity(city),
    archetype: type,
    // A full 24-hour game day is 30 real seconds: 15 seconds of daylight,
    // followed by 15 seconds of dusk, night, and dawn. Survival drain below
    // remains expressed per in-game hour, so each complete day applies the
    // same hunger and thirst cost regardless of frame rate.
    dayLengthSec: 30,
    drainPerHour: { hunger: 0.9 * drainBase, thirst: 1.35 * drainBase },
    freeFood: props.filter((p) => p.data === 'food').length,
    freeWater: props.filter((p) => p.data === 'water').length,
  }
  // procedural, but never a dead end: no clue — and not the gate — may be
  // walled off. Mutates prop blocking flags / carves tiles only when needed.
  // `skipSolvabilityGuard` exists for the dev self-test, which inspects raw
  // generation to explain why the guard had to fire.
  if (!opts.skipSolvabilityGuard) world.solvabilityFixes = ensureSolvable(world)

  return world
}

function makePuzzle(rng: RNG, city: number) {
  const roll = rng.next()
  const hard = city >= 30
  if (roll < 0.4) {
    const words = hard
      ? ['FENCE', 'ALLEY', 'GUARD', 'NIGHT', 'RIVER', 'BRAVE']
      : ['GATE', 'ROAD', 'CITY', 'KEY', 'MAP']
    const word = rng.pick(words)
    const letters = word.split('')
    let scrambled = letters
    for (let tries = 0; tries < 10; tries++) {
      scrambled = rng.shuffle([...letters])
      if (scrambled.join('') !== word) break
    }
    return {
      kind: 'word' as const,
      scrambled: scrambled.join(' '),
      answer: word,
      hint: rng.pick(['Unscramble the letters', 'The letters are shuffled', 'Put the letters back in order']),
    }
  }
  if (roll < 0.7) {
    const a = rng.int(2, 9)
    const b = rng.int(2, 9)
    const c = rng.int(2, 9)
    return {
      kind: 'code' as const,
      prompt: rng.pick([
        `The old gate code: multiply ${a} by ${b}, then add ${c}.`,
        `Gate code, scrawled on a wall: take ${a} times ${b}, then add ${c}.`,
        `Someone chalked a sum by the door: ${a} times ${b}, plus ${c}.`,
        `The code is arithmetic tonight: ${a} times ${b}, then ${c} more.`,
      ]),
      answer: String(a * b + c),
    }
  }
  const symbols = ['▲', '●', '■', '★', '◆']
  const shown = rng.shuffle([...symbols]).slice(0, 4)
  const answer = [0, 1, 2].map(() => rng.int(0, shown.length - 1))
  return {
    kind: 'sequence' as const,
    shown,
    answer,
  }
}
