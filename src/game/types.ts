export interface Vec {
  x: number
  y: number
}

export type CharacterPose = 'idle' | 'run' | 'crouch' | 'climb' | 'sleep' | 'interact'

export type TileKind =
  | 'road'
  | 'sidewalk'
  | 'plaza'
  | 'park'
  | 'grass'
  | 'building'
  | 'wall'
  | 'gate'
  | 'water'

export type PropKind =
  | 'tree'
  | 'fence'
  | 'crate'
  | 'bush'
  | 'dumpster'
  | 'bench'
  | 'fountain'
  | 'stall'
  | 'shop'
  | 'house'
  | 'trash'
  | 'board'
  | 'bar'
  | 'kid'
  | 'radio'
  | 'graffiti'
  | 'coin'
  | 'waterTower'

export interface Prop {
  id: number
  kind: PropKind
  x: number
  y: number
  blocking: boolean
  climbable: boolean
  hide: boolean
  used: boolean
  data?: string
}

export type Puzzle =
  | { kind: 'choice'; question: string; options: string[]; answer: number }
  | { kind: 'word'; scrambled: string; answer: string; hint: string }
  | { kind: 'code'; prompt: string; answer: string }
  | { kind: 'sequence'; shown: string[]; answer: number[] }

export interface Clue {
  propId: number
  x: number
  y: number
  riddle: string // points at the NEXT clue (or the gate once pass is granted)
  /** plain-language locator for the same target, so hard cities stay findable */
  hint: string
  puzzle: Puzzle | null
}

/**
 * What a patrol brings on top of its rank:
 *  - `beat` — a brawler, quick on its feet, normal stare;
 *  - `long` — a watcher with a narrow stare that reaches a long way down a street;
 *  - `wide` — a watcher that sweeps most of a corner at once;
 *  - `gun`  — a shooter: holds its ground and fires down the cone from range.
 */
export type GuardRole = 'beat' | 'long' | 'wide' | 'gun'

export interface Guard {
  id: number
  x: number
  y: number
  path: Vec[]
  wp: number
  /** 0..4 — one step per region: what the patrol can do AND what it looks like */
  tier: number
  /** how this patrol fights, see GuardRole */
  role: GuardRole
  /** the one guard in a handful that wears captain colours and hits harder */
  captain: boolean
  speed: number
  state: 'patrol' | 'suspicious' | 'chase' | 'search' | 'return'
  alert: number // 0..1
  dir: number // facing angle, radians
  lastSeen: Vec | null
  searchTimer: number
  visionDist: number
  visionHalfAngle: number
  stuckTimer: number
  /** seconds until a shooter may fire again (0 for everyone else) */
  attackCd: number
  /** how long the muzzle flash / tracer stays lit, in seconds */
  flash: number
  /** where the last shot was aimed, while `flash` burns */
  shotAt: Vec | null
}

export interface Region {
  /** stable key, used for lore unlock + profile storage */
  id: string
  name: string
  /** one-line hook shown on the world map */
  hook: string
  /** longer flavor text, revealed once all 20 cities here are cleared */
  lore: string
  grass: string
  road: string
  building: string
  buildingAlt: string
  accent: string
  /** primary neon (magenta family) */
  neon: string
  /** secondary neon (cyan family) */
  neon2: string
}

export type ArchetypeId = 'metro' | 'village' | 'forest' | 'future' | 'ruins'

/**
 * The look of a city, changed every five levels. The type decides how the map
 * is built (how many blocks stand, how tall they are, how many trees) and what
 * colours it is painted in; the per-city hue drift on top of that means no two
 * cities in a run read the same.
 */
export interface Archetype {
  id: ArchetypeId
  name: string
  /** one line shown when the city opens */
  blurb: string
  /** share of open blocks that become buildings (the rest turn to park/plaza) */
  build: number
  /** how tall the blocks stand, as a multiple of the normal wall height */
  height: number
  /** relative weight of trees in the scattered cover */
  trees: number
  /** the palette this type pulls the region toward */
  palette: { grass: string; road: string; building: string; buildingAlt: string }
  neon: { accent: string; neon: string; neon2: string }
  /** 0..1 — how far the type palette overrides the region palette */
  blend: number
}

export interface World {
  city: number
  w: number
  h: number
  tiles: TileKind[]
  props: Prop[]
  propAt: Map<number, Prop>
  spawn: Vec
  gate: { x: number; y: number }
  /** locator for the very first clue — shown before the chain is readable */
  entryHint: string
  clues: Clue[]
  guards: Guard[]
  /** the base region, plus the city type and this city's own colour drift */
  region: Region
  /** the type of city this level is: it changes every CITIES_PER_TYPE levels */
  archetype: Archetype
  dayLengthSec: number
  drainPerHour: { hunger: number; thirst: number }
  freeFood: number
  freeWater: number
  /** how many props the solvability pass had to downgrade (0 = clean generation) */
  solvabilityFixes?: number
}

export interface PlayerState {
  x: number
  y: number
  vx: number
  vy: number
  facing: number
  hunger: number
  thirst: number
  health: number
  coins: number
  food: number
  water: number
  hidden: boolean
  mountedProp: number | null
  clueIndex: number
  hasPass: boolean
  anim: number
  moving: boolean
  running: boolean
  /** animation state handed to the character renderer */
  pose: CharacterPose
  /** seconds left on a transient pose (climb / sleep / interact) */
  poseTimer: number
}

export type GameStatus =
  | 'title'
  | 'briefing'
  | 'playing'
  | 'dialog'
  | 'puzzle'
  | 'caught'
  | 'collapsed'
  | 'cityCleared'
  | 'victory'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'good' | 'bad'
  t: number
}

export interface SaveData {
  city: number
  deaths: number
  totalDays: number
  bestCity: number
}
