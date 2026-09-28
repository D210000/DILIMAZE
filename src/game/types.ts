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

export interface Guard {
  id: number
  x: number
  y: number
  path: Vec[]
  wp: number
  speed: number
  state: 'patrol' | 'suspicious' | 'chase' | 'search' | 'return'
  alert: number // 0..1
  dir: number // facing angle, radians
  lastSeen: Vec | null
  searchTimer: number
  visionDist: number
  visionHalfAngle: number
  stuckTimer: number
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
  region: Region
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
