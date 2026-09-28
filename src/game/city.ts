import { RNG } from './rng'
import type {
  Clue,
  Guard,
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

/** never an exact distance — just "how far" in words */
function proximityBand(from: Vec, to: Vec): string {
  const d = Math.hypot(to.x - from.x, to.y - from.y)
  if (d < 7) return 'Right on top of you'
  if (d < 16) return 'A couple of streets away'
  if (d < 30) return 'A fair walk'
  return 'Clear across the city'
}

/** which slice of the map a point sits in — the coarse "where do I look" anchor */
function quarterOf(x: number, y: number, w: number, h: number): string {
  const ew = x < w / 3 ? 'west' : x > (w * 2) / 3 ? 'east' : ''
  const ns = y < h / 3 ? 'north' : y > (h * 2) / 3 ? 'south' : ''
  if (ns && ew) return `the ${ns}${ew} of the city`
  if (ns) return `the ${ns} side of the city`
  if (ew) return `the ${ew} side of the city`
  return 'the dead centre of the city'
}

/**
 * The plain-language locator handed to the player with every clue. The riddle
 * names the landmark; this says roughly where to walk so a City-40 chain is
 * findable without an arrow. Deliberately coarse — no exact block counts.
 */
function locatorHint(from: Vec, to: Vec, w: number, h: number, kind: PropKind | 'border gate'): string {
  return `Hint: ${proximityBand(from, to)}. The ${landmarkName(kind)} waits in ${quarterOf(to.x, to.y, w, h)}.`
}

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

// More guards, wider cones, faster later
function guardSpec(city: number, rng: RNG): { n: number; dist: number; half: number; speed: number } {
  const n = Math.min(10, 2 + Math.floor(city / 12) + rng.int(0, 1))
  const dist = Math.min(9.5, 4.5 + city * 0.05)
  const half = Math.min(0.62, 0.42 + city * 0.002)
  const speed = Math.min(2.6, 1.35 + city * 0.012)
  return { n, dist, half, speed }
}

const RIDDLES: Array<(next: string, gate: string) => string> = [
  (n) => `The next word waits at ${n}.`,
  (n) => `Ask ${n}. They saw the courier pass.`,
  (n) => `Rumor says the stamp hides near ${n}.`,
  (n) => `Nothing is written down. Only ${n} remembers the next line.`,
  (n, g) => `Follow the chain to ${n}... and when the chain ends, ${g} opens.`,
]

export function generateCity(city: number, opts: { skipSolvabilityGuard?: boolean } = {}): World {
  const rng = new RNG(city * 7919 + 13)
  const region = regionForCity(city)
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

  // fill blocks between roads with buildings + pockets of park
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (tiles[idx(x, y)] !== 'grass') continue
      if (rng.chance(0.16)) {
        tiles[idx(x, y)] = rng.chance(0.35) ? 'park' : 'plaza'
        continue
      }
      tiles[idx(x, y)] = 'building'
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
        if (r < 0.3) place('tree')
        else if (r < 0.42) place('bush', { blocking: false, hide: true })
        else if (r < 0.5) place('bench', { blocking: false })
        continue
      }
      if (t === 'plaza' && r < 0.06) {
        place('fountain')
        continue
      }
      if (t === 'sidewalk' || t === 'road') {
        if (r < 0.025) place('tree', { blocking: false })
        else if (r < 0.045) place('crate', { climbable: true })
        else if (r < 0.06) place('fence', { climbable: true })
        else if (r < 0.07) place('dumpster', { climbable: true, hide: true })
        else if (r < 0.085) place('trash', { blocking: false })
        else if (r < 0.095) place('coin', { blocking: false })
        else if (r < 0.105) place('stall')
      }
    }

  // guarantee a fountain
  if (!props.some((p) => p.kind === 'fountain')) {
    const spot = freeSpotNear(Math.floor(w / 2), Math.floor(h / 2)) ?? { x: 2, y: 2 }
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

  const shops = Math.max(1, 2 + Math.floor(city / 25))
  for (let i = 0; i < shops; i++) {
    const s = takeSpot()
    addProp('shop', s.x, s.y, { data: rng.chance(0.5) ? 'food' : 'water' })
  }
  for (let i = 0; i < 2 + Math.floor(city / 20); i++) {
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
  for (let i = 0; i < clues.length; i++) {
    const from: Vec = i === 0 ? spawn : { x: clues[i - 1].x / TS, y: clues[i - 1].y / TS }
    const nextClue = i + 1 < clues.length ? clues[i + 1] : null
    const kind: PropKind | 'border gate' = nextClue
      ? props.find((p) => p.id === nextClue.propId)!.kind
      : 'border gate'
    const target: Vec = nextClue ? { x: nextClue.x / TS, y: nextClue.y / TS } : { x: w - 1, y: gateY + 0.5 }
    if (!nextClue) {
      // the last lead is the gate itself, which deserves its own line
      clues[i].riddle = `End of the trail: ${gateName} sits on the east edge of the city. The stamp opens it.`
    } else {
      const landmark = clueAssist(city, i + 1)
        ? `the ${landmarkName(kind)} (${describeDirection(from, target)})`
        : `the ${landmarkName(kind)}`
      clues[i].riddle = rng.pick(RIDDLES)(landmark, gateName)
    }
    clues[i].hint = locatorHint(from, target, w, h, kind)
  }

  // where the very first clue is, for the scrambled-signal stretch at the start
  const firstClue = clues[0]
  const firstKind = firstClue ? props.find((p) => p.id === firstClue.propId)?.kind ?? 'board' : 'board'
  const entryHint = firstClue
    ? `First lead: ${proximityBand(spawn, { x: firstClue.x / TS, y: firstClue.y / TS })}. The ${landmarkName(firstKind)} waits in ${quarterOf(firstClue.x / TS, firstClue.y / TS, w, h)}.`
    : ''

  // puzzles start appearing from city 4, one per extra clue
  if (city >= 4) {
    for (let i = 0; i < clues.length; i++) {
      if (i === 0) continue // first clue always free
      clues[i].puzzle = makePuzzle(rng, city)
    }
  }

  // guards
  const spec = guardSpec(city, rng)
  const guards: Guard[] = []
  for (let i = 0; i < spec.n; i++) {
    const path: Vec[] = []
    const anchor = cornerSpots.length
      ? cornerSpots[rng.int(0, cornerSpots.length - 1)]
      : { x: rng.int(4, w - 5), y: rng.int(4, h - 5) }
    let cx = Math.floor(anchor.x)
    let cy = Math.floor(anchor.y)
    const nodes = rng.int(3, 5)
    for (let k = 0; k < nodes; k++) {
      // hop to a nearby road tile for a legal patrol route
      for (let tries = 0; tries < 40; tries++) {
        const nx = cx + rng.int(-8, 8)
        const ny = cy + rng.int(-8, 8)
        if (walkable(getTile(nx, ny))) {
          path.push({ x: nx + 0.5, y: ny + 0.5 })
          cx = nx
          cy = ny
          break
        }
      }
    }
    if (path.length === 0) path.push({ x: cx + 0.5, y: cy + 0.5 })
    guards.push({
      id: i,
      x: path[0].x,
      y: path[0].y,
      path,
      wp: 1 % path.length,
      speed: spec.speed,
      state: 'patrol',
      alert: 0,
      dir: rng.float(0, Math.PI * 2),
      lastSeen: null,
      searchTimer: 0,
      visionDist: spec.dist * TS,
      visionHalfAngle: spec.half,
      stuckTimer: 0,
    })
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
    region,
    dayLengthSec: Math.max(150, 240 - city),
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
    return { kind: 'word' as const, scrambled: scrambled.join(' '), answer: word, hint: 'Unscramble the letters' }
  }
  if (roll < 0.7) {
    const a = rng.int(2, 9)
    const b = rng.int(2, 9)
    const c = rng.int(2, 9)
    return {
      kind: 'code' as const,
      prompt: `The old gate code: multiply ${a} by ${b}, then add ${c}.`,
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
