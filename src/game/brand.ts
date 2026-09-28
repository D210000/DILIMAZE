/**
 * Dlicom brand kit — single source of truth for names, colors and avatar skins.
 *
 * PLACEHOLDER: `BRAND.colors` are eyeballed from the Dlicom mascot description
 * (hot-pink/magenta suit + cyan secondary). Swap the hex values here and the
 * whole game re-themes; nothing else hardcodes brand colors.
 */

export const BRAND = {
  /** logo mark shown above the title */
  studio: 'Dlicom',
  game: 'DILIMAZE',
  gameLine2: 'CITIES',
  fullTitle: 'Dilimaze Cities',
  tagline: '100 cities. One hero. Get out of the country.',
  colors: {
    void: '#05030b',
    bg: '#08060f',
    panel: '#120c1f',
    panelEdge: 'rgba(255, 47, 160, 0.35)',
    magenta: '#ff2fa0',
    magentaDeep: '#7a0c50',
    magentaSoft: '#ff8acb',
    /** the mascot's own blue — used for player-owned effects */
    blue: '#1d6dff',
    blueDeep: '#0b3a9e',
    cyan: '#28e6ff',
    cyanDeep: '#0b5566',
    ink: '#f6ecff',
    inkDim: 'rgba(246, 236, 255, 0.62)',
    gold: '#ffd24a',
    good: '#5cffb1',
    bad: '#ff4d4d',
    warn: '#ffa23a',
  },
} as const

import type { CharacterPose } from './types'
import dlicomArt from '../assets/dlicom.png'

/** Animation states the character renderer understands. */
export type { CharacterPose }

/**
 * Optional real-sprite override. Leave `sprite` undefined to use the
 * canvas-drawn mascot; set it to a sheet URL and the renderer blits frames
 * instead — gameplay code never changes.
 */
export interface SpriteSheet {
  url: string
  frameW: number
  frameH: number
  cols: number
  fps: number
  /** which row of the sheet holds each pose */
  poseRows: Partial<Record<CharacterPose, number>>
}

/**
 * Single-frame character art. Drawn at `height` world px, anchored at the feet,
 * and posed procedurally (bob / squash / tilt) since it has no animation frames.
 */
export interface SkinArt {
  url: string
  height: number
}

export interface Skin {
  id: string
  name: string
  blurb: string
  /** real art for the mascot; falls back to the canvas drawing when it can't load */
  image?: SkinArt
  /** hue/saturation recolor applied to `image` for palette variants */
  tint?: string
  /** suit (body) */
  suit: string
  suitDark: string
  suitLight: string
  /** cape / glow */
  accent: string
  /** gloves + boots */
  trim: string
  trimShade: string
  /** helmet glass tint */
  visor: string
  /** chest emblem letter color */
  emblem: string
  /** optional animated sheet — takes priority over `image` when it loads */
  sprite?: SpriteSheet
}

/** the real Dlicom mascot art, shared by every skin (variants recolor it) */
const MASCOT_ART: SkinArt = { url: dlicomArt, height: 38 }

export const SKINS: Skin[] = [
  {
    id: 'dlicom',
    name: 'Dlicom',
    blurb: 'The original. Big eyes, bigger nerve, and a chest full of blue steel.',
    image: MASCOT_ART,
    suit: '#1d6dff',
    suitDark: '#0b3a9e',
    suitLight: '#7fb3ff',
    accent: '#2f8dff',
    trim: '#ffffff',
    trimShade: '#cdd6e8',
    visor: 'rgba(180, 240, 255, 0.34)',
    emblem: '#ffffff',
  },
  {
    id: 'dlicom-neon',
    name: 'Dlicom Neon',
    blurb: 'Cyan shifted patrol variant. Reads like a signal from the other side of the wire.',
    image: MASCOT_ART,
    tint: '#28e6ff',
    suit: '#28e6ff',
    suitDark: '#0b6c8a',
    suitLight: '#9af3ff',
    accent: '#5cf0ff',
    trim: '#ffffff',
    trimShade: '#c6d3e6',
    visor: 'rgba(255, 200, 240, 0.32)',
    emblem: '#05121a',
  },
  {
    id: 'dlicom-ghost',
    name: 'Dlicom Ghost',
    blurb: 'Bleached shell. Cameras keep losing it in the fog.',
    image: MASCOT_ART,
    tint: '#e9eefb',
    suit: '#dfe4f2',
    suitDark: '#8d93a8',
    suitLight: '#ffffff',
    accent: '#b9c2d8',
    trim: '#7f8798',
    trimShade: '#5d6373',
    visor: 'rgba(255, 47, 160, 0.22)',
    emblem: '#ff2fa0',
  },
  {
    id: 'dlicom-sunset',
    name: 'Dlicom Sunset',
    blurb: 'Copper and gold run. Loud enough to be seen, fast enough not to be caught.',
    image: MASCOT_ART,
    tint: '#ff8a3d',
    suit: '#ff6a3d',
    suitDark: '#a3300f',
    suitLight: '#ffb07a',
    accent: '#ffd24a',
    trim: '#fff4e0',
    trimShade: '#d8c9a8',
    visor: 'rgba(140, 240, 255, 0.3)',
    emblem: '#2a0d05',
  },
]

export const DEFAULT_SKIN_ID = 'dlicom'

export function skinById(id: string | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]
}
