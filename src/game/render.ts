import { TS, clueAssist } from './city'
import { drawCharacter } from './character'
import { BRAND } from './brand'
import { dayLight, type Game } from './engine'
import type { Guard, Prop, Region, TileKind, World } from './types'

/**
 * Dlicom world renderer.
 *
 * The city is drawn as a raised, tilted view rather than a flat map: every
 * building block is a 3D box with a lit roof, a shadowed street facing wall and
 * a doorway with steps, roads carry painted crossings and lane dashes, and loose
 * props sit as small boxes on the pavement. The player avatar itself is still
 * drawn by character.ts, untouched by any of this.
 */

const C = BRAND.colors
/** display face for in-world labels (see @font-face in index.css) */
const DISPLAY = '"Youre Gone", ui-monospace, monospace'

/** how deep the south (camera facing) wall of a building block is drawn */
const WALL_STEPS = [13, 17, 21] as const

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

  // A city opens in full sun and darkens toward night as the play goes on;
  // dayLight owns that curve so the guards' night senses agree with the picture.
  // The tint is a violet wash, never a blackout.
  const { darkness } = dayLight(game.timeSec / world.dayLengthSec)
  if (darkness > 0) {
    ctx.fillStyle = `rgba(24, 16, 58, ${darkness})`
    ctx.fillRect(0, 0, viewW, viewH)
    // the hero carries their own light
    const sx = p.x - camX
    const sy = p.y - camY
    const grad = ctx.createRadialGradient(sx, sy, 20, sx, sy, 260)
    grad.addColorStop(0, `rgba(255, 170, 225, ${0.44 * darkness})`)
    grad.addColorStop(0.5, `rgba(150, 90, 220, ${0.2 * darkness})`)
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
  const at = (x: number, y: number): TileKind | null =>
    x < 0 || y < 0 || x >= world.w || y >= world.h ? null : world.tiles[y * world.w + x]
  const isRoad = (x: number, y: number) => at(x, y) === 'road'
  /**
   * A junction is where a street running north/south crosses one running east/
   * west, so the road has to carry on four tiles out on BOTH axes. Tested two
   * tiles out, the middle of a lone street would already look like a junction
   * (it has road above, below and to both sides), which painted most of the map
   * with crossing stripes.
   */
  const isJunction = (x: number, y: number) =>
    isRoad(x, y) && isRoad(x, y - 4) && isRoad(x, y + 4) && isRoad(x - 4, y) && isRoad(x + 4, y)

  /* ---- pass 1: the ground the city sits on -------------------------- */
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const tile = world.tiles[y * world.w + x]
      if (tile === 'building') continue
      const px = x * TS
      const py = y * TS

      if (tile === 'road') {
        paintRoad(ctx, r, x, y, px, py, isRoad, isJunction)
      } else if (tile === 'sidewalk') {
        // neutral stone paving with a kerb lip along every street edge, so the
        // pavements stay clearly separate from the coloured road and the roofs
        ctx.fillStyle = lighten(desaturate(r.road, 0.5), 24)
        ctx.fillRect(px, py, TS, TS)
        ctx.fillStyle = 'rgba(10, 6, 30, 0.09)'
        ctx.fillRect(px, py + 15, TS, 1.6)
        ctx.fillRect(px + 15, py, 1.6, TS)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
        if (isRoad(x, y - 1)) ctx.fillRect(px, py, TS, 3)
        if (isRoad(x, y + 1)) ctx.fillRect(px, py + TS - 3, TS, 3)
        if (isRoad(x - 1, y)) ctx.fillRect(px, py, 3, TS)
        if (isRoad(x + 1, y)) ctx.fillRect(px + TS - 3, py, 3, TS)
        ctx.fillStyle = 'rgba(8, 5, 24, 0.2)'
        if (isRoad(x, y - 1)) ctx.fillRect(px, py + 3, TS, 2)
        if (isRoad(x, y + 1)) ctx.fillRect(px, py + TS - 5, TS, 2)
        if (isRoad(x - 1, y)) ctx.fillRect(px + 3, py, 2, TS)
        if (isRoad(x + 1, y)) ctx.fillRect(px + TS - 5, py, 2, TS)
      } else if (tile === 'plaza') {
        // checkerboard stone, so open squares read differently from pavement
        ctx.fillStyle =
          (x + y) % 2 === 0 ? lighten(desaturate(r.building, 0.45), 32) : lighten(desaturate(r.building, 0.45), 24)
        ctx.fillRect(px, py, TS, TS)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
        ctx.fillRect(px + 4, py + 4, TS - 8, TS - 8)
        ctx.fillStyle = 'rgba(10, 6, 30, 0.08)'
        ctx.fillRect(px, py + 15, TS, 1.4)
        ctx.fillRect(px + 15, py, 1.4, TS)
      } else if (tile === 'park') {
        ctx.fillStyle = lighten(r.grass, 18)
        ctx.fillRect(px, py, TS, TS)
        // mown stripes
        ctx.fillStyle = 'rgba(255, 255, 255, 0.045)'
        ctx.fillRect(px, py + (y % 2) * 16, TS, 16)
        ctx.fillStyle = withAlpha('#7ef7a8', 0.24)
        ctx.fillRect(px + 8, py + 20, 3, 6)
        ctx.fillRect(px + 21, py + 12, 3, 6)
      } else if (tile === 'water') {
        ctx.fillStyle = shift(r.neon2, -40)
        ctx.fillRect(px, py, TS, TS)
        const ripple = (t * 0.5 + tileHash(x, y)) % 1
        ctx.fillStyle = withAlpha(r.neon2, 0.4)
        ctx.fillRect(px + 3, py + 4 + ripple * 20, TS - 6, 2)
      } else {
        ctx.fillStyle = r.grass
        ctx.fillRect(px, py, TS, TS)
        if (tileHash(x, y) > 0.5) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
          ctx.fillRect(px + 4 + tileHash(y, x) * 20, py + 5 + tileHash(x + 3, y) * 20, 3, 3)
        }
      }
    }

  /* ---- pass 2: the blocks themselves, raised into 3D ------------------
   * Rows are painted top to bottom, so a block further down the screen hides
   * the wall of the block behind it, which is what gives the city its depth. */
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (world.tiles[y * world.w + x] !== 'building') continue
      const px = x * TS
      const py = y * TS
      const southOpen = at(x, y + 1) !== 'building'
      const eastOpen = at(x + 1, y) !== 'building'
      // a 2x2 chunk shares one height, so a block reads as one building
      const wall = WALL_STEPS[Math.floor(tileHash(x >> 1, y >> 1) * WALL_STEPS.length) % WALL_STEPS.length]

      // contact shadow on the street the block stands on
      if (southOpen) {
        ctx.fillStyle = 'rgba(6, 4, 20, 0.34)'
        ctx.fillRect(px, py + TS + wall, TS, 5)
      }
      if (eastOpen) {
        ctx.fillStyle = 'rgba(6, 4, 20, 0.26)'
        ctx.fillRect(px + TS, py + wall, 5, TS)
      }

      // the south wall: the face you walk past from the street
      if (southOpen) {
        const faceY = py + TS
        ctx.fillStyle = shade(r.buildingAlt, 26)
        ctx.fillRect(px, faceY, TS, wall)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
        ctx.fillRect(px, faceY + Math.round(wall * 0.45), TS, 1)
        // wall windows
        const lit = tileHash(x, y + 7)
        ctx.fillStyle = withAlpha(r.neon, 0.7)
        if (lit > 0.35) ctx.fillRect(px + 5, faceY + 2, 6, 4)
        if (lit > 0.7) ctx.fillRect(px + 20, faceY + 2, 6, 4)
        ctx.fillStyle = withAlpha(r.neon2, 0.55)
        if (lit < 0.6) ctx.fillRect(px + 13, faceY + 2, 5, 4)
        // plinth along the base, then the parapet lip under the roof
        ctx.fillStyle = shade(r.buildingAlt, 42)
        ctx.fillRect(px, faceY + wall - 2, TS, 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.fillRect(px, faceY - 1.6, TS, 1.6)

        // every block that faces open ground gets a doorway with a flight of
        // steps spilling out of it onto the pavement
        const below = at(x, y + 1)
        if (below === 'sidewalk' || below === 'road' || below === 'plaza' || below === 'park') {
          const doorX = px + 10 + Math.round(tileHash(y + 9, x) * 12)
          const steps = wall > 16 ? 4 : 3
          // a dark apron first, so the treads stand out on pale pavement
          ctx.fillStyle = 'rgba(6, 4, 20, 0.34)'
          ctx.fillRect(doorX - 19, faceY + wall, 38, steps * 4 + 2)
          ctx.fillStyle = 'rgba(5, 3, 18, 0.82)'
          ctx.fillRect(doorX - 7, faceY + 1, 14, wall - 1)
          ctx.fillStyle = withAlpha(C.gold, 0.6)
          ctx.fillRect(doorX - 7, faceY + wall - 4, 14, 1.6)
          drawSteps(
            ctx,
            doorX,
            faceY + wall,
            steps,
            shade(r.buildingAlt, 44),
            lighten(desaturate(r.building, 0.5), 100),
          )
        }
      }

      // the roof, two tones so the block clearly has a top face: a lit parapet
      // ring with a slightly recessed surface inside it
      ctx.fillStyle = lighten(r.building, 30)
      ctx.fillRect(px, py, TS, TS)
      ctx.fillStyle = lighten(r.building, 14)
      ctx.fillRect(px + 3, py + 3, TS - 6, TS - 6)

      // skylights and rooftop clutter, deterministic per tile
      const seed = Math.abs((x * 73856093) ^ (y * 19349663)) % 5
      if (seed < 3) {
        ctx.fillStyle = withAlpha(r.neon, 0.85)
        ctx.fillRect(px + 6, py + 7, 5, 5)
        ctx.fillRect(px + 17, py + 18, 5, 5)
        ctx.fillStyle = withAlpha(r.neon2, 0.75)
        ctx.fillRect(px + 14, py + 7, 5, 5)
      }
      const clutter = tileHash(x + 31, y + 17)
      if (clutter > 0.78) {
        // air conditioning unit
        prism(ctx, px + 11, py + 16, 13, 5, 6, lighten(r.building, 52), shade(r.building, 16))
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'
        ctx.fillRect(px + 5, py + 6, 12, 1.4)
      } else if (clutter > 0.64) {
        // roof hatch
        prism(ctx, px + 21, py + 23, 9, 4, 5, lighten(r.building, 48), shade(r.building, 12))
      } else if (clutter > 0.48) {
        // water tank on legs
        prism(ctx, px + 9, py + 24, 11, 4, 7, lighten(r.building, 56), shade(r.building, 4))
        ctx.strokeStyle = withAlpha(r.neon2, 0.6)
        ctx.lineWidth = 1.2
        ctx.strokeRect(px + 4, py + 13, 11, 11)
      }

      // lit rims only on the outer edges of a block, never across its middle
      ctx.strokeStyle = withAlpha(r.neon2, 0.5)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      if (at(x, y - 1) !== 'building') {
        ctx.moveTo(px, py + 0.7)
        ctx.lineTo(px + TS, py + 0.7)
      }
      if (at(x - 1, y) !== 'building') {
        ctx.moveTo(px + 0.7, py)
        ctx.lineTo(px + 0.7, py + TS)
      }
      if (eastOpen) {
        ctx.moveTo(px + TS - 0.7, py)
        ctx.lineTo(px + TS - 0.7, py + TS)
      }
      ctx.stroke()
    }

  // slow scanline sweep sells the "digital underworld" look — cheap and subtle
  const sweep = ((t * 40) % (viewH + 200)) - 100
  ctx.fillStyle = withAlpha(r.neon2, 0.05)
  ctx.fillRect(camX, camY + sweep, viewW, 3)
}

/**
 * Asphalt, kerb lines, a painted crossing ring around junctions and dashes
 * along the middle of every street.
 */
function paintRoad(
  ctx: CanvasRenderingContext2D,
  r: Region,
  x: number,
  y: number,
  px: number,
  py: number,
  isRoad: (x: number, y: number) => boolean,
  isJunction: (x: number, y: number) => boolean,
) {
  const up = isRoad(x, y - 1)
  const down = isRoad(x, y + 1)
  const left = isRoad(x - 1, y)
  const right = isRoad(x + 1, y)

  ctx.fillStyle = r.road
  ctx.fillRect(px, py, TS, TS)
  // a sheen band so the surface is not a flat slab
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)'
  ctx.fillRect(px, py + 4, TS, 11)

  // worn gutters and a painted edge line where the street meets the kerb
  ctx.fillStyle = 'rgba(8, 5, 24, 0.18)'
  if (!left) ctx.fillRect(px, py, 3, TS)
  if (!right) ctx.fillRect(px + TS - 3, py, 3, TS)
  if (!up) ctx.fillRect(px, py, TS, 3)
  if (!down) ctx.fillRect(px, py + TS - 3, TS, 3)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.17)'
  if (!left) ctx.fillRect(px + 3, py, 1.4, TS)
  if (!right) ctx.fillRect(px + TS - 4.4, py, 1.4, TS)
  if (!up) ctx.fillRect(px, py + 3, TS, 1.4)
  if (!down) ctx.fillRect(px, py + TS - 4.4, TS, 1.4)

  // the middle of an intersection: darker tarmac with a painted box around the
  // whole junction. The box is drawn edge by edge, only where the neighbour is
  // not part of the junction too, so the middle stays one open square instead of
  // a grid of outlined tiles.
  if (isJunction(x, y)) {
    ctx.fillStyle = 'rgba(6, 4, 20, 0.18)'
    ctx.fillRect(px, py, TS, TS)
    const inset = 6
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    if (!isJunction(x, y - 1)) {
      ctx.moveTo(px + inset, py + inset)
      ctx.lineTo(px + TS - inset, py + inset)
    }
    if (!isJunction(x, y + 1)) {
      ctx.moveTo(px + inset, py + TS - inset)
      ctx.lineTo(px + TS - inset, py + TS - inset)
    }
    if (!isJunction(x - 1, y)) {
      ctx.moveTo(px + inset, py + inset)
      ctx.lineTo(px + inset, py + TS - inset)
    }
    if (!isJunction(x + 1, y)) {
      ctx.moveTo(px + TS - inset, py + inset)
      ctx.lineTo(px + TS - inset, py + TS - inset)
    }
    ctx.stroke()
    return
  }

  // zebra bars on the one tile either side of a junction. The bars run with the
  // traffic and are repeated across the road, and only the street tiles get
  // them, never the junction block itself, which used to stripe most of the map.
  let crossing: 'v' | 'h' | null = null
  if (up && down && (isJunction(x, y - 1) || isJunction(x, y + 1))) crossing = 'v'
  else if (left && right && (isJunction(x - 1, y) || isJunction(x + 1, y))) crossing = 'h'

  if (crossing) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)'
    for (let i = 0; i < 4; i++) {
      if (crossing === 'v') ctx.fillRect(px + 3 + i * 8, py + 3, 4, TS - 6)
      else ctx.fillRect(px + 3, py + 3 + i * 8, TS - 6, 4)
    }
    return
  }

  // lane dashes along the middle of a street (never into a junction)
  const midV = left && right && !isRoad(x - 2, y) && !isRoad(x + 2, y)
  const midH = up && down && !isRoad(x, y - 2) && !isRoad(x, y + 2)
  ctx.fillStyle = 'rgba(255, 244, 205, 0.4)'
  if (midV && (Math.abs(y) % 2 === 0)) ctx.fillRect(px + TS / 2 - 2, py + 6, 4, 20)
  else if (midH && (Math.abs(x) % 2 === 0)) ctx.fillRect(px + 6, py + TS / 2 - 2, 20, 4)

  // manhole covers and patched asphalt
  const h = tileHash(x, y)
  if (h > 0.88) {
    ctx.fillStyle = 'rgba(10, 6, 28, 0.34)'
    ctx.beginPath()
    ctx.arc(px + 16, py + 16, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.lineWidth = 1
    ctx.stroke()
  } else if (h < 0.06) {
    ctx.fillStyle = 'rgba(10, 6, 28, 0.16)'
    ctx.fillRect(px + 5, py + 19, 22, 9)
  }
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
    case 'tree': {
      // trunk as a small box, canopy as a dome stacked above it
      prism(ctx, x, y + 5, 7, 3, 9, '#5a4a80', '#372c52')
      const cy = y - 13
      ctx.fillStyle = '#2f7c50'
      ctx.beginPath()
      ctx.arc(x, cy + 3, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#45996a'
      ctx.beginPath()
      ctx.arc(x, cy, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.beginPath()
      ctx.arc(x - 3, cy - 3, 3.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(r.neon2, 0.7)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(x, cy, 10, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'bush': {
      // a hiding bush must read as cover on bright pavement
      const leaf = pr.used ? '#37704a' : '#458f5f'
      ctx.fillStyle = shade(leaf, 26)
      ctx.beginPath()
      ctx.arc(x, y + 2, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = leaf
      ctx.beginPath()
      ctx.arc(x, y - 1, 9.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.beginPath()
      ctx.arc(x - 3, y - 4, 3.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(r.neon, 0.75)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(x, y - 1, 9.5, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    case 'bench': {
      const seat = pr.data === 'sleep' ? '#8342a0' : '#5b4880'
      // slab seat with a back rest behind it, so it reads in 3D
      prism(ctx, x, y + 5, 22, 7, 5, seat, shade(seat, 34))
      ctx.fillStyle = pr.data === 'sleep' ? r.neon : '#8a72b4'
      ctx.fillRect(x - 11, y - 13, 22, 3)
      ctx.fillStyle = shade(seat, 36)
      ctx.fillRect(x - 11, y - 10, 22, 2)
      ctx.fillRect(x - 10, y - 10, 2, 9)
      ctx.fillRect(x + 8, y - 10, 2, 9)
      break
    }
    case 'fountain': {
      // raised rim with water inside and a jet above it
      ctx.fillStyle = shade('#356085', 26)
      ctx.beginPath()
      ctx.arc(x, y + 2, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#8ec2e4'
      ctx.beginPath()
      ctx.arc(x, y - 1, 13, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#356085'
      ctx.beginPath()
      ctx.arc(x, y - 1, 9.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(C.cyan, 0.55)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y - 1, 9.5, 0, Math.PI * 2)
      ctx.stroke()
      const jet = Math.sin(performance.now() / 320) * 1.5
      ctx.fillStyle = withAlpha(C.cyan, 0.9)
      ctx.beginPath()
      ctx.arc(x, y - 6 + jet, 2.8, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'crate': {
      // climbable cover: a chunky braced box
      prism(ctx, x, y + 5, 20, 8, 10, '#8d68ad', '#5a3f78')
      ctx.strokeStyle = r.neon
      ctx.lineWidth = 1.5
      ctx.strokeRect(x - 10, y - 5, 20, 10)
      ctx.beginPath()
      ctx.moveTo(x - 10, y - 5)
      ctx.lineTo(x + 10, y + 5)
      ctx.moveTo(x + 10, y - 5)
      ctx.lineTo(x - 10, y + 5)
      ctx.stroke()
      break
    }
    case 'fence':
      ctx.strokeStyle = '#9d92c8'
      ctx.lineWidth = 1.8
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(x + i * 5, y - 10)
        ctx.lineTo(x + i * 5, y + 8)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(x - 12, y - 6)
      ctx.lineTo(x + 12, y - 6)
      ctx.moveTo(x - 12, y + 4)
      ctx.lineTo(x + 12, y + 4)
      ctx.stroke()
      ctx.fillStyle = 'rgba(8, 5, 24, 0.3)'
      ctx.fillRect(x - 12, y + 9, 24, 3)
      break
    case 'dumpster':
      prism(ctx, x, y + 5, 22, 8, 9, '#4a9c8b', '#286356')
      ctx.fillStyle = '#3a8070'
      ctx.fillRect(x - 11, y - 12, 22, 3)
      ctx.strokeStyle = withAlpha(C.cyan, 0.6)
      ctx.lineWidth = 1.4
      ctx.strokeRect(x - 11, y - 4, 22, 9)
      break
    case 'trash':
      prism(ctx, x, y + 5, 12, 4, 9, '#8a79b6', '#4b4070')
      ctx.strokeStyle = withAlpha(C.cyan, 0.5)
      ctx.lineWidth = 1.2
      ctx.strokeRect(x - 6, y - 4, 12, 9)
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
    case 'stall': {
      // a counter with posts and a striped awning over it
      prism(ctx, x, y + 6, 24, 7, 8, '#7a66a8', '#4b3b73')
      ctx.fillStyle = r.neon
      ctx.fillRect(x - 12, y + 1, 24, 2.4)
      ctx.fillStyle = '#6b58a0'
      ctx.fillRect(x - 11, y - 14, 3, 16)
      ctx.fillRect(x + 8, y - 14, 3, 16)
      ctx.fillStyle = r.neon
      ctx.fillRect(x - 13, y - 18, 26, 4)
      ctx.fillStyle = shade(r.neon, 36)
      ctx.fillRect(x - 13, y - 14, 26, 2)
      break
    }
    case 'shop':
    case 'bar':
    case 'house':
    case 'board':
    case 'radio':
    case 'graffiti':
    case 'kid':
      drawClueProp(ctx, pr, r)
      break
    case 'waterTower': {
      // legs, a 3D tank and a cone roof above it
      ctx.strokeStyle = '#9186c0'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x - 9, y + 6)
      ctx.lineTo(x - 6, y - 12)
      ctx.moveTo(x + 9, y + 6)
      ctx.lineTo(x + 6, y - 12)
      ctx.stroke()
      prism(ctx, x, y - 12, 26, 8, 12, '#bdb2e4', '#6f64a4')
      ctx.fillStyle = '#ddd5ff'
      ctx.beginPath()
      ctx.moveTo(x - 13, y - 20)
      ctx.lineTo(x + 13, y - 20)
      ctx.lineTo(x, y - 29)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = withAlpha(C.cyan, 0.6)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x - 13, y - 20)
      ctx.lineTo(x + 13, y - 20)
      ctx.lineTo(x, y - 29)
      ctx.closePath()
      ctx.stroke()
      break
    }
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
  prism(ctx, x, y + 5, 12, 4, 9, '#8a79b6', '#4b4070')
  ctx.fillStyle = '#66669c'
  ctx.beginPath()
  ctx.moveTo(x - 9, y - 1)
  ctx.lineTo(x + 6, y - 6)
  ctx.lineTo(x + 7, y - 3)
  ctx.lineTo(x - 8, y + 2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** a house that already gave what it had: lights out, door shut */
function drawShutHouse(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.9
  prism(ctx, x, y + 7, 26, 8, 14, '#55447f', '#2d2150')
  ctx.fillStyle = '#241a44'
  ctx.fillRect(x - 3, y - 3, 6, 10)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.fillRect(x - 12, y - 7, 7, 6)
  ctx.fillStyle = '#6b5a9a'
  ctx.fillRect(x - 13, y - 15, 26, 3)
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
    case 'shop': {
      prism(ctx, x, y + 7, 30, 9, 16, '#5a4488', '#332655')
      // signboard across the front face, with the doorway under it
      ctx.fillStyle = withAlpha(r.neon, 0.95)
      ctx.fillRect(x - 15, y - 9, 30, 5)
      ctx.fillStyle = C.ink
      ctx.font = `bold 11px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText(pr.data === 'food' ? 'FOOD' : 'WATER', x, y - 5)
      ctx.textAlign = 'left'
      ctx.fillStyle = withAlpha(C.gold, 0.55)
      ctx.fillRect(x - 13, y - 2, 9, 9)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.fillRect(x + 1, y - 3, 12, 8)
      break
    }
    case 'bar': {
      prism(ctx, x, y + 7, 28, 8, 15, '#66419a', '#3a2459')
      ctx.fillStyle = withAlpha(r.neon, 0.9)
      ctx.fillRect(x - 14, y - 8, 28, 5)
      ctx.fillStyle = C.ink
      ctx.font = `bold 11px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText('BAR', x, y - 4)
      ctx.textAlign = 'left'
      ctx.fillStyle = withAlpha(C.gold, 0.5)
      ctx.fillRect(x - 12, y - 1, 8, 8)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
      ctx.fillRect(x + 2, y - 2, 10, 7)
      break
    }
    case 'house': {
      prism(ctx, x, y + 7, 26, 8, 14, '#6b53a0', '#3d2d63')
      ctx.fillStyle = withAlpha(C.gold, 0.85)
      ctx.fillRect(x - 3, y - 3, 6, 10)
      ctx.fillStyle = withAlpha(C.cyan, 0.55)
      ctx.fillRect(x - 12, y - 7, 7, 6)
      ctx.fillStyle = withAlpha(C.cyan, 0.4)
      ctx.fillRect(x + 5, y - 7, 7, 6)
      // parapet along the front edge of the roof
      ctx.fillStyle = '#8b71c6'
      ctx.fillRect(x - 13, y - 15, 26, 3)
      ctx.fillStyle = '#ab93e2'
      ctx.fillRect(x - 13, y - 15, 26, 1.4)
      break
    }
    case 'board': {
      // a lean to notice board on two legs
      ctx.fillStyle = '#5a3f2a'
      ctx.fillRect(x - 8, y - 2, 3, 9)
      ctx.fillRect(x + 5, y - 2, 3, 9)
      prism(ctx, x, y + 2, 20, 4, 14, '#8a6238', '#442f1c')
      ctx.fillStyle = '#f4ead0'
      ctx.fillRect(x - 9, y - 13, 18, 9)
      ctx.fillStyle = '#4a3420'
      ctx.font = `bold 9px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText('POSTED', x, y - 6)
      ctx.textAlign = 'left'
      break
    }
    case 'radio': {
      const t = performance.now() / 200
      prism(ctx, x, y + 4, 20, 6, 12, '#6a55a0', '#3d2e66')
      ctx.fillStyle = withAlpha(neon, 0.95)
      ctx.fillRect(x - 7, y - 4, 10, 4)
      ctx.fillStyle = withAlpha(C.cyan, 0.85)
      ctx.fillRect(x - 8, y + 1, 3, 3)
      ctx.fillRect(x - 3, y + 1, 3, 3)
      ctx.strokeStyle = withAlpha(C.cyan, 0.6 + Math.sin(t) * 0.3)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x + 6, y - 8)
      ctx.lineTo(x + 13, y - 21)
      ctx.stroke()
      break
    }
    case 'graffiti': {
      // a wall stub with a tag on it
      prism(ctx, x, y + 6, 24, 6, 12, '#5b4488', '#332552')
      ctx.strokeStyle = withAlpha(r.neon, 0.95)
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x - 9, y + 2)
      ctx.lineTo(x - 3, y - 5)
      ctx.lineTo(x + 2, y + 1)
      ctx.lineTo(x + 8, y - 6)
      ctx.stroke()
      break
    }
    case 'kid':
      ctx.fillStyle = 'rgba(8, 5, 24, 0.3)'
      ctx.beginPath()
      ctx.ellipse(x, y + 7, 8, 3, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#6b52a0'
      ctx.fillRect(x - 5, y - 3, 10, 10)
      ctx.fillStyle = '#5a4480'
      ctx.beginPath()
      ctx.arc(x, y - 8, 6.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(C.gold, 0.5)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = withAlpha(C.gold, 0.95)
      ctx.beginPath()
      ctx.arc(x - 2, y - 9, 1.6, 0, Math.PI * 2)
      ctx.arc(x + 2, y - 9, 1.6, 0, Math.PI * 2)
      ctx.fill()
      break
  }
}

/** one uniform per tier: light patrols at the fence line, plated enforcers east */
type GuardArt = {
  coat: string
  coatLit: string
  plate: string
  trim: string
  visor: string
  boot: string
}

const GUARD_ART: GuardArt[] = [
  { coat: '#c9d3f2', coatLit: '#e8edff', plate: '#98a5d4', trim: '#7cf0ff', visor: '#8ff0ff', boot: '#3a3f60' },
  { coat: '#93a2d8', coatLit: '#b8c4f0', plate: '#6f7cb4', trim: '#6cc8ff', visor: '#7ce0ff', boot: '#31374f' },
  { coat: '#6b74a8', coatLit: '#8f98cb', plate: '#4d5680', trim: '#ffd24a', visor: '#ffd24a', boot: '#262b42' },
  { coat: '#4f5480', coatLit: '#7075a6', plate: '#383d61', trim: '#ff9a3c', visor: '#ff9a3c', boot: '#1d2036' },
  { coat: '#3d2b40', coatLit: '#5b4360', plate: '#281b2c', trim: '#ff5470', visor: '#ff6a84', boot: '#140d20' },
]

/**
 * Guards are people, not pips: boots, a plated coat, a helmeted visor and rank
 * ticks, all sized and coloured by tier, so a Borderlands enforcer is visibly
 * heavier than a Fringe patrol before it ever sees you. Captains add gold.
 */
function drawGuard(ctx: CanvasRenderingContext2D, gd: Guard, r: Region) {
  const chasing = gd.state === 'chase'
  const uneasy = !chasing && gd.alert > 0.4
  const art = GUARD_ART[Math.max(0, Math.min(GUARD_ART.length - 1, gd.tier))]
  // every tier stands taller and wider, and a captain a step further again
  const s = 1 + gd.tier * 0.07 + (gd.captain ? 0.07 : 0)
  const standing = gd.state === 'search' || gd.state === 'suspicious'
  const step = standing ? 0 : Math.sin(performance.now() / 170 + gd.id * 1.9)
  const glow = chasing ? C.bad : uneasy ? C.warn : art.visor

  const feet = gd.y + 9 * s
  const hip = feet - 6.5 * s
  const shoulder = hip - 7 * s
  const headY = shoulder - 3.4 * s

  ctx.save()

  // state glow on the ground, so a hunting guard still reads from across the street
  const halo = ctx.createRadialGradient(gd.x, hip, 2, gd.x, hip, 20 * s)
  halo.addColorStop(0, withAlpha(glow, chasing ? 0.34 : 0.16))
  halo.addColorStop(1, withAlpha(glow, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(gd.x, hip, 20 * s, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(8, 5, 22, 0.45)'
  ctx.beginPath()
  ctx.ellipse(gd.x, feet + 1, 9.5 * s, 3.4 * s, 0, 0, Math.PI * 2)
  ctx.fill()

  // boots, alternating with the stride
  ctx.fillStyle = art.boot
  ctx.fillRect(gd.x - 5.4 * s, hip + Math.abs(step) * 1.4 * s, 4.6 * s, 6.5 * s)
  ctx.fillRect(gd.x + 0.8 * s, hip - Math.abs(step) * 1.4 * s, 4.6 * s, 6.5 * s)

  // tapered coat with a lit side, so the body is not a flat rectangle
  ctx.fillStyle = art.coat
  ctx.beginPath()
  ctx.moveTo(gd.x - 4.6 * s, shoulder)
  ctx.lineTo(gd.x + 4.6 * s, shoulder)
  ctx.lineTo(gd.x + 6.3 * s, hip + 1.4 * s)
  ctx.lineTo(gd.x - 6.3 * s, hip + 1.4 * s)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = art.coatLit
  ctx.fillRect(gd.x - 4.3 * s, shoulder, 2.6 * s, hip - shoulder)
  ctx.fillStyle = 'rgba(10, 6, 26, 0.35)'
  ctx.fillRect(gd.x + 4.2 * s, shoulder, 1.6 * s, hip - shoulder)

  // shoulder plates, gold on a captain
  ctx.fillStyle = art.plate
  ctx.fillRect(gd.x - 7.5 * s, shoulder - 1.6 * s, 3.6 * s, 3.4 * s)
  ctx.fillRect(gd.x + 3.9 * s, shoulder - 1.6 * s, 3.6 * s, 3.4 * s)
  if (gd.captain) {
    ctx.fillStyle = C.gold
    ctx.fillRect(gd.x - 7.5 * s, shoulder - 2.8 * s, 3.6 * s, 1.4 * s)
    ctx.fillRect(gd.x + 3.9 * s, shoulder - 2.8 * s, 3.6 * s, 1.4 * s)
  }

  // chest lamp: the better equipped tiers carry one
  if (gd.tier >= 1) {
    ctx.fillStyle = withAlpha(art.visor, 0.9)
    ctx.fillRect(gd.x - 1.2 * s, shoulder + 2.4 * s, 2.4 * s, 2.4 * s)
  }

  // a rim of the region's own neon, so a guard belongs to the street it walks
  ctx.strokeStyle = withAlpha(r.neon2, 0.45)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(gd.x - 6.3 * s, hip + 1.4 * s)
  ctx.lineTo(gd.x - 4.6 * s, shoulder)
  ctx.stroke()

  // helmet dome, visor slit and rank ticks along the brow
  ctx.fillStyle = art.plate
  ctx.beginPath()
  ctx.arc(gd.x, headY, 4.7 * s, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(gd.x - 4.7 * s, headY - 0.6 * s, 9.4 * s, 3.4 * s)
  ctx.fillStyle = glow
  ctx.shadowColor = glow
  ctx.shadowBlur = chasing ? 12 : 7
  ctx.fillRect(gd.x - 3.4 * s, headY + 0.1 * s, 6.8 * s, 1.9 * s)
  ctx.shadowBlur = 0
  ctx.fillStyle = gd.captain ? C.gold : art.trim
  for (let i = 0; i < gd.tier; i++) ctx.fillRect(gd.x - 3 * s + i * 2.2 * s, headY - 4.6 * s, 1.3 * s, 1.3 * s)

  // captain's plume
  if (gd.captain) {
    ctx.fillStyle = C.gold
    ctx.fillRect(gd.x - 1.1 * s, headY - 7.6 * s, 2.2 * s, 3.4 * s)
  }
  ctx.restore()

  // the way they are facing
  ctx.strokeStyle = withAlpha(glow, 0.5)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(gd.x + Math.cos(gd.dir) * 6, hip + Math.sin(gd.dir) * 6)
  ctx.lineTo(gd.x + Math.cos(gd.dir) * 15, hip + Math.sin(gd.dir) * 15)
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

/**
 * A raised box: the front face is `h` tall and sits on `frontY`, and the top
 * face (w by depth) sits directly above it. Drawing the front first and the top
 * second is all the perspective this projection needs.
 */
function prism(
  ctx: CanvasRenderingContext2D,
  cx: number,
  frontY: number,
  w: number,
  depth: number,
  h: number,
  top: string,
  side: string,
) {
  const x = cx - w / 2
  const faceY = frontY - h
  ctx.fillStyle = side
  ctx.fillRect(x, faceY, w, h)
  ctx.fillStyle = top
  ctx.fillRect(x, faceY - depth, w, depth)
  // bright seam where the two faces meet, so the corner reads
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.fillRect(x, faceY - 1, w, 1)
}

/**
 * The entrance steps of a building: a fan of treads spilling out of the
 * doorway onto the pavement, widest at the bottom so the flight reads as stairs.
 */
function drawSteps(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  steps: number,
  dark: string,
  light: string,
) {
  for (let i = 0; i < steps; i++) {
    // widest at the bottom, so the flight fans out of the doorway
    const w = 22 + i * 5
    const y = baseY + i * 4
    ctx.fillStyle = i % 2 === 0 ? dark : light
    ctx.fillRect(cx - w / 2, y, w, 4)
    // the nosing of each tread catches the light, the riser below it is shadow
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.fillRect(cx - w / 2, y, w, 1.5)
    ctx.fillStyle = 'rgba(4, 2, 14, 0.5)'
    ctx.fillRect(cx - w / 2, y + 3.2, w, 0.8)
  }
}

/** deterministic 0..1 noise per tile, so the detail never flickers between frames */
function tileHash(x: number, y: number): number {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x51ed, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2545f491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

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

/** the shadowed side of a surface: the same hue, darker */
function shade(hex: string, amt: number): string {
  return shift(hex, -amt)
}

/** pull a colour toward grey, so pavements read as stone and not as road */
function desaturate(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const grey = (r + g + b) / 3
  const f = (c: number) => Math.round(c + (grey - c) * amount)
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0')}`
}

function shift(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amt))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
