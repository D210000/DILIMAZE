import { TS, clueAssist } from './city'
import { drawCharacter } from './character'
import { BRAND } from './brand'
import type { Game } from './engine'
import type { Prop, Region, World } from './types'

/**
 * Dlicom world renderer: near-black ground, magenta/cyan neon rims on anything
 * interactive, soft red-orange guard cones. The player avatar itself is drawn
 * by character.ts (swap in a real sprite there, not here).
 */

const C = BRAND.colors
/** display face for in-world labels (see @font-face in index.css) */
const DISPLAY = '"Youre Gone", ui-monospace, monospace'

export function render(ctx: CanvasRenderingContext2D, game: Game, viewW: number, viewH: number) {
  const world = game.world
  const p = game.player
  const r = world.region

  // dusk sky the city is carved out of — only visible past the map edges
  const bg = ctx.createLinearGradient(0, 0, 0, viewH)
  bg.addColorStop(0, '#2a2350')
  bg.addColorStop(0.55, '#241d47')
  bg.addColorStop(1, '#151132')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, viewW, viewH)

  const camX = Math.max(0, Math.min(world.w * TS - viewW, p.x - viewW / 2))
  const camY = Math.max(0, Math.min(world.h * TS - viewH, p.y - viewH / 2))

  ctx.save()
  ctx.translate(-camX, -camY)

  drawTiles(ctx, world, camX, camY, viewW, viewH)
  drawGate(ctx, world, game)

  const visible = world.props.filter(
    (pr) => pr.x > camX - 60 && pr.x < camX + viewW + 60 && pr.y > camY - 60 && pr.y < camY + viewH + 60,
  )
  visible.sort((a, b) => a.y - b.y)
  const solved = new Set(world.clues.slice(0, p.clueIndex).map((c) => c.propId))
  const nextClueId = world.clues[p.clueIndex]?.propId ?? -1
  // clue hint rings exist only in the opening cities, for the first two clues
  const assisted = clueAssist(world.city, p.clueIndex)
  for (const pr of visible) {
    // picked-up $DLI leaves the map entirely
    if (pr.used && pr.kind === 'coin') continue
    drawProp(ctx, pr, world)
    drawPropBadges(ctx, pr, { solved: solved.has(pr.id), isNext: pr.id === nextClueId, assisted, hasPass: p.hasPass })
  }

  drawGuardCones(ctx, world)
  for (const gd of world.guards) drawGuard(ctx, gd, r)

  // the hero usually sits on bright ground now, so give them a contact glow
  // that keeps the silhouette readable against neon-lit asphalt
  const heroGlow = ctx.createRadialGradient(p.x, p.y + 4, 4, p.x, p.y + 4, 34)
  heroGlow.addColorStop(0, 'rgba(10, 6, 26, 0.5)')
  heroGlow.addColorStop(0.6, 'rgba(10, 6, 26, 0.22)')
  heroGlow.addColorStop(1, 'rgba(10, 6, 26, 0)')
  ctx.fillStyle = heroGlow
  ctx.beginPath()
  ctx.arc(p.x, p.y + 4, 34, 0, Math.PI * 2)
  ctx.fill()

  // the hero
  drawCharacter(ctx, {
    x: p.x,
    y: p.y + 6,
    facing: p.facing,
    pose: p.pose,
    // run cycle follows the stride clock; idle breathes on its own slow clock
    anim: p.moving ? p.anim / 3 : performance.now() / 550,
    skin: game.getSkin(),
    ghost: p.hidden,
    time: performance.now(),
  })

  // tracker: an arrow at the screen edge when the next clue is off camera
  const trackProp = world.propAt.get(world.clues[p.clueIndex]?.propId ?? -1)
  if (trackProp && !p.hasPass && assisted) {
    {
      const prop = trackProp
      const sx = prop.x - camX
      const sy = prop.y - camY
      const offScreen = sx < 0 || sy < 0 || sx > viewW || sy > viewH
      const pulse = (Math.sin(performance.now() / 240) + 1) / 2
      if (offScreen) {
        // park the arrow just inside the viewport, pointing at the clue
        const cx = viewW / 2
        const cy = viewH / 2
        const ang = Math.atan2(sy - cy, sx - cx)
        const pad = 46
        const ex = cx + Math.cos(ang) * (Math.min(viewW, viewH) / 2 - pad)
        const ey = cy + Math.sin(ang) * (Math.min(viewW, viewH) / 2 - pad)
        const a = 0.55 + pulse * 0.2
        ctx.save()
        ctx.translate(camX + ex, camY + ey)
        ctx.rotate(ang)
        ctx.fillStyle = withAlpha(C.gold, a)
        ctx.shadowColor = C.gold
        ctx.shadowBlur = 14
        ctx.beginPath()
        ctx.moveTo(11, 0)
        ctx.lineTo(-7, -8)
        ctx.lineTo(-3, 0)
        ctx.lineTo(-7, 8)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      } else {
        ctx.save()
        ctx.font = `14px ${DISPLAY}`
        ctx.textAlign = 'center'
        const label = `${Math.max(1, Math.round(Math.hypot(prop.x - p.x, prop.y - p.y) / TS))}`
        ctx.lineWidth = 3.5
        ctx.strokeStyle = 'rgba(10, 6, 26, 0.85)'
        ctx.strokeText(label, prop.x, prop.y - 22)
        ctx.fillStyle = withAlpha(C.gold, 0.95)
        ctx.fillText(label, prop.x, prop.y - 22)
        ctx.restore()
      }
    }
  }

  ctx.restore()

  // ambient depth: magenta bloom at the edges, night tint on top
  drawVignette(ctx, viewW, viewH, r)

  const dayFrac = game.timeSec / world.dayLengthSec
  // night still reads as night and still sharpens the guards' cones, but the
  // street stays legible: the tint is a violet wash, never a blackout
  let darkness = 0
  if (dayFrac > 0.7) darkness = Math.min(0.45, ((dayFrac - 0.7) / 0.15) * 0.45)
  if (dayFrac < 0.12) darkness = Math.max(0, 0.45 * (1 - dayFrac / 0.12))
  if (darkness > 0) {
    ctx.fillStyle = `rgba(24, 16, 58, ${darkness})`
    ctx.fillRect(0, 0, viewW, viewH)
    // the hero carries their own light
    const sx = p.x - camX
    const sy = p.y - camY
    const grad = ctx.createRadialGradient(sx, sy, 20, sx, sy, 260)
    grad.addColorStop(0, `rgba(255, 170, 225, ${0.3 * darkness})`)
    grad.addColorStop(0.5, `rgba(150, 90, 220, ${0.14 * darkness})`)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, viewW, viewH)
  }

  if (p.hidden) {
    ctx.fillStyle = 'rgba(10, 6, 26, 0.26)'
    ctx.fillRect(0, 0, viewW, viewH)
    ctx.font = `15px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(10, 6, 26, 0.85)'
    ctx.strokeText('HIDDEN', p.x - camX, p.y - camY - 46)
    ctx.fillStyle = C.cyan
    ctx.fillText('HIDDEN', p.x - camX, p.y - camY - 46)
    ctx.textAlign = 'left'
  }
}

/* ---------------------------------------------------------------- */

function drawTiles(
  ctx: CanvasRenderingContext2D,
  world: World,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
) {
  const x0 = Math.max(0, Math.floor(camX / TS))
  const y0 = Math.max(0, Math.floor(camY / TS))
  const x1 = Math.min(world.w - 1, Math.ceil((camX + viewW) / TS))
  const y1 = Math.min(world.h - 1, Math.ceil((camY + viewH) / TS))
  const r = world.region
  const t = performance.now() / 1000

  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const tile = world.tiles[y * world.w + x]
      let color = r.grass
      if (tile === 'road') color = r.road
      else if (tile === 'sidewalk') color = lighten(r.road, 16)
      else if (tile === 'plaza') color = lighten(r.building, 12)
      else if (tile === 'park') color = lighten(r.grass, 16)
      else if (tile === 'building') color = r.buildingAlt
      else if (tile === 'water') color = r.neon2
      ctx.fillStyle = color
      ctx.fillRect(x * TS, y * TS, TS, TS)

      if (tile === 'building') {
        // rooftops: a light shade only, so the block still reads as a block
        ctx.fillStyle = 'rgba(10, 8, 30, 0.12)'
        ctx.fillRect(x * TS, y * TS, TS, TS)
        // lit windows, deterministic per tile
        const seed = (x * 73856093) ^ (y * 19349663)
        const lit = Math.abs(seed) % 5
        if (lit < 3) {
          const count = lit < 1 ? 3 : 2
          ctx.fillStyle = withAlpha(r.neon, 0.9)
          ctx.fillRect(x * TS + 6, y * TS + 8, 5, 5)
          ctx.fillRect(x * TS + 17, y * TS + 19, 5, 5)
          if (count === 3) ctx.fillRect(x * TS + 23, y * TS + 8, 5, 5)
          ctx.fillStyle = withAlpha(r.neon2, 0.8)
          ctx.fillRect(x * TS + 14, y * TS + 8, 5, 5)
          ctx.fillRect(x * TS + 7, y * TS + 19, 5, 5)
        }
        ctx.strokeStyle = withAlpha(r.neon2, 0.5)
        ctx.lineWidth = 1.4
        ctx.strokeRect(x * TS + 0.5, y * TS + 0.5, TS - 1, TS - 1)
      } else if (tile === 'road') {
        // dashed neon lane marking on vertical roads
        if (world.tiles[y * world.w + Math.min(world.w - 1, x + 1)] === 'road' && y % 2 === 0) {
          ctx.fillStyle = withAlpha('#ffffff', 0.32)
          ctx.fillRect(x * TS + TS / 2 - 1, y * TS + 6, 2, 9)
        }
      } else if (tile === 'park') {
        ctx.fillStyle = withAlpha(r.neon2, 0.1)
        ctx.fillRect(x * TS, y * TS, TS, TS)
        // a couple of blades so parks read as green space, not just pavement
        ctx.fillStyle = withAlpha('#7ef7a8', 0.22)
        ctx.fillRect(x * TS + 8, y * TS + 20, 3, 6)
        ctx.fillRect(x * TS + 21, y * TS + 12, 3, 6)
      }
    }

  // slow scanline sweep sells the "digital underworld" look — cheap and subtle
  const sweep = ((t * 40) % (viewH + 200)) - 100
  ctx.fillStyle = withAlpha(r.neon2, 0.05)
  ctx.fillRect(camX, camY + sweep, viewW, 3)
}

function drawGate(ctx: CanvasRenderingContext2D, world: World, game: Game) {
  const g = world.gate
  const x = (world.w - 1) * TS
  const y = g.y * TS
  const open = game.player.hasPass
  const color = open ? C.gold : '#9d92c8'
  const pulse = (Math.sin(performance.now() / 260) + 1) / 2

  ctx.save()
  if (open) {
    ctx.shadowColor = C.gold
    ctx.shadowBlur = 18
  }
  ctx.fillStyle = color
  ctx.fillRect(x - 8, y - TS * 1.5, 10, TS * 3)
  ctx.fillRect(x - 8, y + TS * 1.5 - 8, 10, 8)
  ctx.restore()

  ctx.font = `14px ${DISPLAY}`
  ctx.lineWidth = 3.5
  ctx.strokeStyle = 'rgba(10, 6, 26, 0.85)'
  ctx.strokeText(open ? 'EXIT ✓' : 'LOCKED', x - 28, y - TS * 1.5 - 8)
  ctx.fillStyle = open ? C.gold : '#e6dffb'
  ctx.fillText(open ? 'EXIT ✓' : 'LOCKED', x - 28, y - TS * 1.5 - 8)
  if (open) {
    ring(ctx, x, y, 24 + pulse * 7, C.gold, 0.35 + pulse * 0.5)
  }
}

function drawProp(ctx: CanvasRenderingContext2D, pr: Prop, world: World) {
  const x = pr.x
  const y = pr.y
  const r = world.region
  const isClue = pr.data === 'clue'

  // spent props read as empty: a searched bin, a shut house
  if (pr.used && pr.kind === 'trash') {
    drawEmptyBin(ctx, x, y)
    return
  }
  if (pr.used && pr.kind === 'house') {
    drawShutHouse(ctx, x, y)
    return
  }

  ctx.save()
  if (isClue) {
    ctx.shadowColor = C.gold
    ctx.shadowBlur = 14
  } else if (pr.kind === 'coin') {
    ctx.shadowColor = C.gold
    ctx.shadowBlur = 12
  } else if (INTERACTIVE.has(pr.kind)) {
    ctx.shadowColor = r.neon2
    ctx.shadowBlur = 9
  }

  switch (pr.kind) {
    case 'tree':
      ctx.fillStyle = '#463a63'
      ctx.fillRect(x - 2, y - 2, 4, 10)
      ctx.fillStyle = '#3f8f60'
      ctx.beginPath()
      ctx.arc(x, y - 7, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.beginPath()
      ctx.arc(x - 3, y - 10, 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(r.neon2, 0.7)
      ctx.lineWidth = 1.2
      ctx.stroke()
      break
    case 'bush':
      // a hiding bush must read as cover on bright pavement
      ctx.fillStyle = pr.used ? '#3d7a52' : '#4aa06a'
      ctx.beginPath()
      ctx.arc(x, y, 9.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.beginPath()
      ctx.arc(x - 3, y - 3, 3.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(r.neon, 0.75)
      ctx.lineWidth = 1.2
      ctx.stroke()
      break
    case 'bench':
      ctx.fillStyle = pr.data === 'sleep' ? '#7d3f96' : '#5b4880'
      ctx.fillRect(x - 10, y - 4, 20, 6)
      ctx.fillStyle = pr.data === 'sleep' ? r.neon : '#8a72b4'
      ctx.fillRect(x - 10, y - 6, 20, 2)
      break
    case 'fountain':
      ctx.fillStyle = '#356085'
      ctx.beginPath()
      ctx.arc(x, y, 12, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(C.cyan, 0.5)
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = C.cyan
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(x - 2, y - 2, 2.6, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'crate': {
      ctx.fillStyle = '#7a5a94'
      ctx.fillRect(x - 10, y - 10, 20, 20)
      ctx.strokeStyle = r.neon
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 10, y - 10, 20, 20)
      ctx.beginPath()
      ctx.moveTo(x - 10, y - 10)
      ctx.lineTo(x + 10, y + 10)
      ctx.moveTo(x + 10, y - 10)
      ctx.lineTo(x - 10, y + 10)
      ctx.stroke()
      break
    }
    case 'fence':
      ctx.strokeStyle = '#9d92c8'
      ctx.lineWidth = 1.8
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(x + i * 5, y - 8)
        ctx.lineTo(x + i * 5, y + 8)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(x - 12, y - 5)
      ctx.lineTo(x + 12, y - 5)
      ctx.moveTo(x - 12, y + 5)
      ctx.lineTo(x + 12, y + 5)
      ctx.stroke()
      break
    case 'dumpster':
      ctx.fillStyle = '#2f6a5e'
      ctx.fillRect(x - 11, y - 8, 22, 16)
      ctx.fillStyle = '#3a8070'
      ctx.fillRect(x - 11, y - 8, 22, 5)
      ctx.strokeStyle = withAlpha(C.cyan, 0.6)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 11, y - 8, 22, 16)
      break
    case 'trash':
      ctx.fillStyle = '#66578f'
      ctx.fillRect(x - 5, y - 7, 10, 13)
      ctx.strokeStyle = withAlpha(C.cyan, 0.5)
      ctx.lineWidth = 1.2
      ctx.strokeRect(x - 5, y - 7, 10, 13)
      break
    case 'coin': {
      // $DLI token
      const bob = Math.sin(performance.now() / 300) * 1.5
      const cy = y + bob
      ctx.fillStyle = C.gold
      ctx.beginPath()
      ctx.arc(x, cy, 6.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff6cf'
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.fillStyle = '#3d2a04'
      ctx.font = 'bold 10px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('$', x, cy + 3.6)
      ctx.textAlign = 'left'
      break
    }
    case 'stall':
      ctx.fillStyle = r.neon
      ctx.fillRect(x - 12, y - 12, 24, 9)
      ctx.fillStyle = '#5c4d86'
      ctx.fillRect(x - 10, y - 3, 20, 9)
      ctx.strokeStyle = withAlpha(C.cyan, 0.55)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 12, y - 12, 24, 18)
      break
    case 'shop':
    case 'bar':
    case 'house':
    case 'board':
    case 'radio':
    case 'graffiti':
    case 'kid':
      drawClueProp(ctx, pr, r)
      break
    case 'waterTower':
      ctx.fillStyle = '#9186c0'
      ctx.fillRect(x - 12, y - 20, 4, 30)
      ctx.fillRect(x + 8, y - 20, 4, 30)
      ctx.fillStyle = '#ada2d6'
      ctx.fillRect(x - 14, y - 26, 28, 12)
      ctx.strokeStyle = withAlpha(C.cyan, 0.6)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 14, y - 26, 28, 12)
      ctx.fillStyle = withAlpha(C.cyan, 0.5)
      ctx.fillRect(x - 7, y - 22, 2, 4)
      ctx.fillRect(x - 1, y - 22, 2, 4)
      ctx.fillRect(x + 5, y - 22, 2, 4)
      break
  }
  ctx.restore()
}

/**
 * Landmarks the player has already talked to. Bins and houses aren't here — they
 * get their own empty art instead of the crossed-out stamp.
 */
const SPENT_PROPS = new Set(['board', 'bar', 'kid', 'radio', 'graffiti'])

interface PropMarks {
  solved: boolean
  isNext: boolean
  /** opening cities + first two clues only */
  assisted: boolean
  hasPass: boolean
}

/** stamps on top of a prop: clue rings, "already done" check marks, empty state */
function drawPropBadges(ctx: CanvasRenderingContext2D, pr: Prop, m: PropMarks) {
  if (m.hasPass && !m.solved) return

  if (m.solved) {
    // collected clue: dimmed, and checked off so the player can see it's done
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#05030b'
    ctx.beginPath()
    ctx.arc(pr.x, pr.y, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = withAlpha(C.good, 0.85)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pr.x - 5, pr.y - 1)
    ctx.lineTo(pr.x - 1, pr.y + 4)
    ctx.lineTo(pr.x + 6, pr.y - 5)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (pr.used && SPENT_PROPS.has(pr.kind)) {
    // already talked to / searched: dimmed with a small check
    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.fillStyle = '#05030b'
    ctx.fillRect(pr.x - 15, pr.y - 17, 30, 30)
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = withAlpha(C.magentaSoft, 0.7)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pr.x - 4, pr.y - 4)
    ctx.lineTo(pr.x + 4, pr.y + 4)
    ctx.moveTo(pr.x + 4, pr.y - 4)
    ctx.lineTo(pr.x - 4, pr.y + 4)
    ctx.stroke()
    ctx.restore()
    return
  }

  const isClue = pr.data === 'clue'
  if (!isClue || !m.assisted) return
  const pulse = (Math.sin(performance.now() / 220) + 1) / 2
  if (m.isNext) ring(ctx, pr.x, pr.y, 15 + pulse * 6, C.gold, 0.3 + pulse * 0.5)
  else ring(ctx, pr.x, pr.y, 9, C.magentaSoft, 0.18) // other chain landmarks, opening cities only
}

/** a searched bin: lid flipped open, nothing inside */
function drawEmptyBin(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.fillStyle = '#4f4f7d'
  ctx.fillRect(x - 5, y - 3, 10, 10)
  ctx.strokeStyle = withAlpha(C.cyan, 0.5)
  ctx.lineWidth = 1.2
  ctx.strokeRect(x - 5, y - 3, 10, 10)
  ctx.fillStyle = '#66669c'
  ctx.beginPath()
  ctx.moveTo(x - 9, y - 6)
  ctx.lineTo(x + 6, y - 9)
  ctx.lineTo(x + 7, y - 6)
  ctx.lineTo(x - 8, y - 3)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** a house that already gave what it had: lights out, door shut */
function drawShutHouse(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.8
  ctx.fillStyle = '#3a2f68'
  ctx.fillRect(x - 13, y - 13, 26, 26)
  ctx.fillStyle = '#4b3d80'
  ctx.fillRect(x - 13, y - 13, 26, 6)
  ctx.fillStyle = '#5c4d90'
  ctx.fillRect(x - 3, y + 1, 6, 12)
  ctx.strokeStyle = withAlpha(C.cyan, 0.5)
  ctx.lineWidth = 1.2
  ctx.strokeRect(x - 3, y + 1, 6, 12)
  ctx.strokeRect(x - 13, y - 13, 26, 26)
  ctx.restore()
}

const INTERACTIVE = new Set([
  'fountain',
  'bench',
  'shop',
  'stall',
  'house',
  'trash',
  'coin',
  'board',
  'bar',
  'kid',
  'radio',
  'graffiti',
  'waterTower',
  'crate',
  'dumpster',
])

function drawClueProp(ctx: CanvasRenderingContext2D, pr: Prop, r: Region) {
  const x = pr.x
  const y = pr.y
  const neon = pr.data === 'clue' ? C.gold : r.neon
  switch (pr.kind) {
    case 'shop':
      ctx.fillStyle = '#3d2c66'
      ctx.fillRect(x - 15, y - 15, 30, 30)
      ctx.fillStyle = withAlpha(r.neon, 0.95)
      ctx.fillRect(x - 15, y - 15, 30, 6)
      ctx.fillStyle = C.ink
      ctx.font = `bold 12px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText(pr.data === 'food' ? 'FOOD' : 'WATER', x, y + 4)
      ctx.textAlign = 'left'
      ctx.strokeStyle = withAlpha(r.neon, 0.5)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 15, y - 15, 30, 30)
      break
    case 'bar':
      ctx.fillStyle = '#4a2f6b'
      ctx.fillRect(x - 14, y - 14, 28, 28)
      ctx.fillStyle = withAlpha(r.neon, 0.9)
      ctx.fillRect(x - 14, y - 14, 28, 5)
      ctx.fillStyle = C.ink
      ctx.font = `bold 12px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText('BAR', x, y + 4)
      ctx.textAlign = 'left'
      ctx.strokeStyle = withAlpha(r.neon, 0.55)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 14, y - 14, 28, 28)
      break
    case 'house':
      ctx.fillStyle = '#4d3a78'
      ctx.fillRect(x - 13, y - 13, 26, 26)
      ctx.fillStyle = withAlpha(r.neon2, 0.75)
      ctx.fillRect(x - 13, y - 13, 26, 6)
      ctx.fillStyle = withAlpha(C.gold, 0.85)
      ctx.fillRect(x - 3, y + 1, 6, 12)
      ctx.fillStyle = withAlpha(C.cyan, 0.5)
      ctx.fillRect(x - 4, y - 4, 8, 5)
      ctx.strokeStyle = withAlpha(r.neon2, 0.35)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 13, y - 13, 26, 26)
      break
    case 'board':
      ctx.fillStyle = '#5a3f2a'
      ctx.fillRect(x - 10, y - 13, 20, 16)
      ctx.fillStyle = '#f4ead0'
      ctx.fillRect(x - 8, y - 11, 16, 11)
      ctx.strokeStyle = withAlpha(C.gold, 0.95)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 10, y - 13, 20, 16)
      ctx.fillStyle = '#4a3420'
      ctx.font = `bold 9px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText('POSTED', x, y - 4)
      ctx.textAlign = 'left'
      break
    case 'radio': {
      const t = performance.now() / 200
      ctx.fillStyle = '#4a3a75'
      ctx.fillRect(x - 9, y - 7, 18, 14)
      ctx.strokeStyle = withAlpha(C.cyan, 0.6 + Math.sin(t) * 0.3)
      ctx.beginPath()
      ctx.moveTo(x + 5, y - 7)
      ctx.lineTo(x + 11, y - 16)
      ctx.stroke()
      ctx.fillStyle = withAlpha(neon, 0.95)
      ctx.fillRect(x - 6, y - 3, 8, 4)
      ctx.fillStyle = withAlpha(C.cyan, 0.8)
      ctx.fillRect(x - 7, y + 1, 3, 3)
      ctx.fillRect(x - 2, y + 1, 3, 3)
      ctx.strokeStyle = withAlpha(C.cyan, 0.4)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 9, y - 7, 18, 14)
      break
    }
    case 'graffiti':
      ctx.fillStyle = '#3f2d60'
      ctx.fillRect(x - 12, y - 10, 24, 20)
      ctx.strokeStyle = withAlpha(r.neon, 0.95)
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x - 9, y + 4)
      ctx.lineTo(x - 3, y - 4)
      ctx.lineTo(x + 2, y + 3)
      ctx.lineTo(x + 8, y - 5)
      ctx.stroke()
      ctx.strokeStyle = withAlpha(C.cyan, 0.6)
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 12, y - 10, 24, 20)
      break
    case 'kid':
      ctx.fillStyle = '#5a4480'
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(C.gold, 0.5)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = withAlpha(C.gold, 0.95)
      ctx.beginPath()
      ctx.arc(x - 2, y - 1, 1.6, 0, Math.PI * 2)
      ctx.arc(x + 2, y - 1, 1.6, 0, Math.PI * 2)
      ctx.fill()
      break
  }
}

function drawGuard(
  ctx: CanvasRenderingContext2D,
  gd: { x: number; y: number; state: string; alert: number; dir: number },
  r: Region,
) {
  const chasing = gd.state === 'chase'
  const color = chasing ? C.bad : gd.alert > 0.4 ? C.warn : '#e8e2ff'
  ctx.save()
  ctx.shadowColor = chasing ? C.bad : withAlpha(r.neon2, 0.85)
  ctx.shadowBlur = chasing ? 14 : 9
  // dark backing so the little torch-bearer reads on bright pavement
  ctx.fillStyle = 'rgba(12, 8, 30, 0.55)'
  ctx.beginPath()
  ctx.arc(gd.x, gd.y, 7.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(gd.x, gd.y, 6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(gd.x, gd.y + 6)
  ctx.lineTo(gd.x, gd.y + 14)
  ctx.stroke()
  ctx.fillStyle = chasing ? C.bad : '#7c8fd6'
  ctx.fillRect(gd.x - 5, gd.y - 10, 10, 3)
  ctx.restore()

  // torch line showing facing
  ctx.strokeStyle = withAlpha(color, 0.5)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(gd.x, gd.y - 4)
  ctx.lineTo(gd.x + Math.cos(gd.dir) * 12, gd.y - 4 + Math.sin(gd.dir) * 12)
  ctx.stroke()
}

function drawGuardCones(ctx: CanvasRenderingContext2D, world: World) {
  for (const gd of world.guards) {
    const chasing = gd.state === 'chase'
    const base = chasing ? [255, 60, 60] : gd.alert > 0.4 ? [255, 160, 60] : [255, 120, 120]
    const alpha = chasing ? 0.34 : gd.alert > 0.4 ? 0.26 : 0.17

    const grad = ctx.createRadialGradient(gd.x, gd.y, 4, gd.x, gd.y, gd.visionDist)
    grad.addColorStop(0, `rgba(${base[0]},${base[1]},${base[2]},${alpha + 0.1})`)
    grad.addColorStop(1, `rgba(${base[0]},${base[1]},${base[2]},0)`)

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(gd.x, gd.y)
    ctx.arc(gd.x, gd.y, gd.visionDist, gd.dir - gd.visionHalfAngle, gd.dir + gd.visionHalfAngle)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha * 1.6})`
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, viewW: number, viewH: number, r: Region) {
  // gentle corner shading for depth — never dark enough to hide the street
  const g = ctx.createRadialGradient(
    viewW / 2,
    viewH / 2,
    Math.min(viewW, viewH) * 0.4,
    viewW / 2,
    viewH / 2,
    Math.max(viewW, viewH) * 0.8,
  )
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(22, 14, 52, 0.4)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, viewW, viewH)
  ctx.fillStyle = withAlpha(r.neon, 0.05)
  ctx.fillRect(0, 0, viewW, viewH)
}

/* ---------------------------------------------------------------- */

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
  ctx.save()
  ctx.strokeStyle = withAlpha(color, alpha)
  ctx.lineWidth = 2
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${a})`
}

function lighten(hex: string, amt: number): string {
  return shift(hex, amt)
}

function shift(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amt))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
