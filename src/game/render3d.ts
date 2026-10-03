import { TS, clueAssist } from './city'
import { drawCharacter } from './character'
import { BRAND } from './brand'
import { dayLight, streetRight, MAX_DARKNESS, type Game } from './engine'
import type { Guard, TileKind, World } from './types'
import { drawGuard, drawProp, drawPropBadges, withAlpha, lighten, shade, desaturate, tileHash } from './render'
import type { PropMarks } from './render'

/**
 * The eye level street camera.
 *
 * The map view draws the city from above; this draws it from the pavement: a
 * chase camera a few strides behind the runner builds a simple perspective
 * basis, the ground recedes to a horizon and every block stands up as a real
 * box with a window grid. A sky with a sun and a moon moves with the day arc,
 * light and fog are baked into every surface colour, and the same prop, guard
 * and avatar art is re-used and scaled by depth. No engine, no extra assets.
 */

const C = BRAND.colors
const DISPLAY = '"Youre Gone", ui-monospace, monospace'

/** block height steps for the walk view, before the city type multiplier */
const WALL_STEPS = [14, 18, 22] as const
/** blocks read as buildings here, not tiles: several times the map height */
const BUILDING_SCALE = 3.6

const NEAR = 6

type Box = {
  x0: number
  y0: number
  x1: number
  y1: number
  h: number
  cx: number
  cy: number
  /** border walls: no window grid, just stone */
  plain?: boolean
}
const boxCache = new WeakMap<World, Box[]>()

/** shortest signed angle from a to b */
function angleDiff(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function wallHeight(world: World, tx: number, ty: number): number {
  const idx = Math.floor(tileHash(tx >> 1, ty >> 1) * WALL_STEPS.length) % WALL_STEPS.length
  return Math.max(20, Math.round(WALL_STEPS[idx] * (world.archetype?.height ?? 1) * BUILDING_SCALE))
}

/** exact rectangular runs of building tiles, computed once per city */
function buildingBoxes(world: World): Box[] {
  const cached = boxCache.get(world)
  if (cached) return cached
  const seen = new Uint8Array(world.w * world.h)
  const boxes: Box[] = []
  for (let y = 0; y < world.h; y++)
    for (let x = 0; x < world.w; x++) {
      const i = y * world.w + x
      if (seen[i] || world.tiles[i] !== 'building') continue
      // Greedily take the widest unclaimed row run, then extend it downward
      // only while every tile in that rectangle is still a building. Flood
      // fill plus a bounding box filled L-shaped blocks across their empty
      // street gaps, which left the camera looking through uncovered ground.
      let x1 = x + 1
      while (x1 < world.w && !seen[y * world.w + x1] && world.tiles[y * world.w + x1] === 'building') x1++
      let y1 = y + 1
      const rowFits = (row: number) => {
        for (let tx = x; tx < x1; tx++) {
          const ri = row * world.w + tx
          if (seen[ri] || world.tiles[ri] !== 'building') return false
        }
        return true
      }
      while (y1 < world.h && rowFits(y1)) y1++
      let h = 0
      for (let ty = y; ty < y1; ty++)
        for (let tx = x; tx < x1; tx++) {
          seen[ty * world.w + tx] = 1
          h = Math.max(h, wallHeight(world, tx, ty))
        }
      boxes.push({
        x0: x,
        y0: y,
        x1,
        y1,
        h,
        cx: ((x + x1) / 2) * TS,
        cy: ((y + y1) / 2) * TS,
      })
    }

  // a ring wall around the whole map, so the city has a visible border instead
  // of an open edge. Split into short segments so each is depth culled on its own
  // and a nearby stretch never pops out with a far one.
  const BORDER_H = Math.round(2.6 * TS)
  const SEG = 8
  const pushWall = (x0: number, y0: number, x1: number, y1: number) =>
    boxes.push({ x0, y0, x1, y1, h: BORDER_H, cx: ((x0 + x1) / 2) * TS, cy: ((y0 + y1) / 2) * TS, plain: true })
  for (let x = -2; x < world.w + 2; x += SEG) {
    const x1 = Math.min(x + SEG, world.w + 2)
    pushWall(x, -2, x1, -1) // north
    pushWall(x, world.h + 1, x1, world.h + 2) // south
  }
  // no wall on the west edge: that is the way into the city, and the chase
  // camera opens the run sitting just outside it. Building a wall there used to
  // fill the very first frame with nothing but stone.
  for (let y = -2; y < world.h + 2; y += SEG) {
    const y1 = Math.min(y + SEG, world.h + 2)
    pushWall(world.w + 1, y, world.w + 2, y1) // east, behind the border gate
  }

  boxCache.set(world, boxes)
  return boxes
}

/* ------------------------------------------------------------------ */
/* colour helpers (light, tint and fog are baked into every surface)   */
/* ------------------------------------------------------------------ */

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, '0')}`
}

/** multiply a colour by a per channel light factor */
function lit(hex: string, mr: number, mg: number, mb: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r * mr, g * mg, b * mb)
}

/** blend two colours, t=0 gives a, t=1 gives b */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

export function render3D(ctx: CanvasRenderingContext2D, game: Game, viewW: number, viewH: number) {
  const world = game.world
  const p = game.player
  const r = world.region
  const now = performance.now()

  /* ---- the sky clock ---------------------------------------------------- */
  // The light comes straight from dayLight, the same curve the map view paints
  // from, so the two cameras can never disagree about the hour. What is local to
  // this view is where the sun and moon hang in the sky: the day runs 06:00 to
  // 18:00, and the sun's own arc begins already clear of the horizon, so a city
  // that opens at time zero is a bright morning under a blue sky instead of a dim
  // orange haze that reads as a wall of shadow.
  const frac = Math.min(1, Math.max(0, game.timeSec / world.dayLengthSec))
  const { darkness } = dayLight(frac)
  const nightAmt = darkness / MAX_DARKNESS // 0 through the day, 1 in the small hours
  const dayAmt = 1 - nightAmt
  const sunUp = frac < 0.5 ? Math.sin(Math.PI * (0.15 + 0.85 * (frac / 0.5))) : 0
  // warm light clings to a low sun at either end of the day and nowhere else
  const warm =
    frac < 0.5
      ? Math.max(0, Math.min(1, (0.45 - sunUp) / 0.45))
      : Math.max(0, Math.min(1, 1 - (frac - 0.5) / 0.12))

  // sky palette: blue day, orange only on the low sun, starred navy night
  const nightTop = '#070a1c'
  const nightHorizon = '#1a2240'
  const dayTop = '#3a80dd'
  const dayHorizon = '#b7d6f5'
  const duskTop = '#3a2a63'
  const duskHorizon = '#e5834a'
  const skyTop = mix(mix(dayTop, duskTop, warm), nightTop, nightAmt)
  const skyHorizon = mix(mix(dayHorizon, duskHorizon, warm), nightHorizon, nightAmt)

  /* ---- camera rig ------------------------------------------------------- */
  const yaw = game.camYaw
  const bob = p.moving ? Math.sin(p.anim * 0.9) * (p.running ? 2.2 : 1.1) : 0
  const CAM_BACK = TS * 6
  const CAM_H = TS * 2.8
  const camX = p.x - Math.cos(yaw) * CAM_BACK
  const camY = p.y - Math.sin(yaw) * CAM_BACK
  const camZ = CAM_H + bob

  const lookX = p.x + Math.cos(yaw) * TS * 2.4
  const lookY = p.y + Math.sin(yaw) * TS * 2.4
  // the pitch drag raises or lowers where the camera is aimed
  const lookZ = TS * 0.85 - game.camPitch * TS * 3.5 + bob * 0.5

  let fx = lookX - camX
  let fy = lookY - camY
  let fz = lookZ - camZ
  const flen = Math.hypot(fx, fy, fz) || 1
  fx /= flen
  fy /= flen
  fz /= flen
  // The runner's right hand, from the same helper the walk mapping steps with,
  // so the drawn right edge of the street is the direction D moves. Screen up
  // is forward cross right, which keeps pointing up as the camera pitches.
  const right = streetRight(yaw)
  let rx = right.x
  let ry = right.y
  const rlen = Math.hypot(rx, ry) || 1
  rx /= rlen
  ry /= rlen
  const rz = 0
  const ux = -fz * ry
  const uy = fz * rx
  const uz = fx * ry - fy * rx

  const focal = viewH * 0.82
  const cxScreen = viewW / 2
  const horizon = viewH * 0.42

  const project = (wx: number, wy: number, wz: number): { x: number; y: number; s: number; depth: number } | null => {
    const dx = wx - camX
    const dy = wy - camY
    const dz = wz - camZ
    const depth = dx * fx + dy * fy + dz * fz
    if (depth <= NEAR) return null
    const sxv = dx * rx + dy * ry + dz * rz
    const syv = dx * ux + dy * uy + dz * uz
    const s = focal / depth
    return { x: cxScreen + sxv * s, y: horizon - syv * s, s, depth }
  }

  // Clip every world polygon against the camera's near plane before projecting.
  // Dropping a whole quad because one corner is too close opens dark holes as
  // the runner passes buildings and ground tiles.
  const clipProjectPolygon = (points: Array<{ x: number; y: number; z: number }>): Pt[] => {
    const depthOf = (v: { x: number; y: number; z: number }) =>
      (v.x - camX) * fx + (v.y - camY) * fy + (v.z - camZ) * fz
    const clipped: Array<{ x: number; y: number; z: number }> = []
    let prev = points[points.length - 1]
    let prevDepth = depthOf(prev)
    for (const curr of points) {
      const currDepth = depthOf(curr)
      const prevInside = prevDepth > NEAR
      const currInside = currDepth > NEAR
      if (prevInside !== currInside) {
        const t = (NEAR + 0.01 - prevDepth) / (currDepth - prevDepth)
        clipped.push({
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
          z: prev.z + (curr.z - prev.z) * t,
        })
      }
      if (currInside) clipped.push(curr)
      prev = curr
      prevDepth = currDepth
    }
    return clipped.map((v) => {
      const pt = project(v.x, v.y, v.z)
      return pt ? { x: pt.x, y: pt.y } : null
    }).filter((pt): pt is Pt => pt !== null)
  }

  /* ---- sky, sun and moon ------------------------------------------------ */
  const sky = ctx.createLinearGradient(0, 0, 0, horizon + 40)
  sky.addColorStop(0, skyTop)
  sky.addColorStop(1, skyHorizon)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, viewW, horizon + 40)

  // stars at night
  if (nightAmt > 0.05) {
    ctx.fillStyle = `rgba(255,255,255,${0.7 * nightAmt})`
    for (let i = 0; i < 60; i++) {
      const hx = tileHash(i, 7) * viewW
      const hy = tileHash(i, 13) * horizon * 0.9
      const tw = 0.6 + tileHash(i, 21) * 1.2
      ctx.fillRect(hx, hy, tw, tw)
    }
  }

  const drawBody = (
    fx0: number,
    fy0: number,
    radius: number,
    glow: string,
    core: string,
    alpha: number,
  ) => {
    const g = ctx.createRadialGradient(fx0, fy0, radius * 0.2, fx0, fy0, radius * 3)
    g.addColorStop(0, withAlpha(glow, alpha))
    g.addColorStop(0.4, withAlpha(glow, alpha * 0.35))
    g.addColorStop(1, withAlpha(glow, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(fx0, fy0, radius * 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(fx0, fy0, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  if (frac < 0.5) {
    const t = frac / 0.5
    const sx = viewW * (0.08 + 0.84 * t)
    const sy = horizon - sunUp * horizon * 0.82
    const radius = 20 + 5 * sunUp
    drawBody(sx, sy, radius, '#ffce85', '#fff3cf', 0.85)
  } else {
    const t = (frac - 0.5) / 0.5
    const sx = viewW * (0.92 - 0.84 * t)
    const sy = horizon - Math.sin(Math.PI * t) * horizon * 0.78
    drawBody(sx, sy, 20, '#cdd8ff', '#f2f5ff', 0.6)
    // a soft shadow bite, so the moon reads as a moon and not a sun
    ctx.fillStyle = withAlpha('#1b2340', 0.85 * Math.max(0.2, nightAmt))
    ctx.beginPath()
    ctx.arc(sx + 9, sy - 4, 17, 0, Math.PI * 2)
    ctx.fill()
  }

  /* ---- the light every surface is built from ---------------------------- */
  const amb = 1 - darkness * 0.9
  const mr = amb * (1 + 0.24 * warm)
  const mg = amb * (1 + 0.05 * warm)
  const mb = amb * (1 - 0.12 * warm) * (frac < 0.5 ? 1 : 0.72)
  // Pavement and grass need a little more fill light than vertical surfaces.
  // Letting the blue night multiplier fall all the way with the skyline made
  // edge tiles read as black holes once the player had walked into dusk.
  const floorMr = Math.max(0.72, mr)
  const floorMg = Math.max(0.72, mg)
  const floorMb = Math.max(0.72, mb)

  /* ---- ground base, so the world past the map edge is not sky ----------- */
  // The fallback sits under off-map corners and any clipped world geometry.
  // Grass-only colouring made those uncovered wedges read as black cut-outs
  // beside the brighter asphalt, especially while the near edge of a tile
  // crossed the camera plane. Blend the city's grass into its road and keep
  // the base close to the pavement value so an exposed seam stays unobtrusive.
  const groundFar = lit(mix(desaturate(r.grass, 0.28), desaturate(r.road, 0.5), 0.56), floorMr * 0.94, floorMg * 0.94, floorMb * 0.94)
  const groundNear = lit(desaturate(r.road, 0.44), floorMr * 0.96, floorMg * 0.96, floorMb * 0.96)
  const fallbackGround = ctx.createLinearGradient(0, horizon, 0, viewH)
  fallbackGround.addColorStop(0, groundFar)
  fallbackGround.addColorStop(1, groundNear)
  ctx.fillStyle = fallbackGround
  ctx.fillRect(0, horizon - 2, viewW, viewH - (horizon - 2))

  const quad = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    d: { x: number; y: number },
    color: string,
  ) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
  }

  const groundColor = (x: number, y: number, tile: TileKind): string => {
    switch (tile) {
      case 'road':
        return r.road
      case 'sidewalk':
        return lighten(desaturate(r.road, 0.5), 22)
      case 'plaza':
        return (x + y) % 2 === 0
          ? lighten(desaturate(r.building, 0.5), 30)
          : lighten(desaturate(r.building, 0.5), 20)
      case 'park':
        return lighten(r.grass, 14)
      case 'water':
        return shade(r.neon2, 40)
      case 'wall':
        return shade(r.building, 10)
      case 'gate':
        return r.neon
      default:
        return r.grass
    }
  }

  /* ---- ground tiles, far to near, lit and fogged ------------------------ */
  // Every tile the view can actually see is projected and drawn each frame, so
  // nothing is streamed in as the runner moves and the ground can never pop.
  // They are only skipped once the WHOLE quad is off the screen, which is why
  // the test must allow for the tile's own projected size: a tile close to the
  // camera projects very large, and culling it on its centre alone used to cut a
  // visible chunk out of the near ground, a dark bare patch at the edges.
  const mapReach = Math.hypot(world.w, world.h) * TS + TS * 2
  const maxD2 = mapReach * mapReach
  const tiles: Array<{ d: number; x: number; y: number }> = []
  for (let ty = 0; ty < world.h; ty++)
    for (let tx = 0; tx < world.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) continue
      if (world.tiles[ty * world.w + tx] === 'building') continue
      const wx = (tx + 0.5) * TS
      const wy = (ty + 0.5) * TS
      const ddx = wx - camX
      const ddy = wy - camY
      const depth = ddx * fx + ddy * fy
      if (ddx * ddx + ddy * ddy > maxD2) continue
      if (depth > TS * 3) {
        const inv = focal / depth
        // half the tile's projected diagonal on screen, so the margin grows with
        // how large that tile actually draws
        const rad = TS * inv * 0.75
        const sx = (ddx * rx + ddy * ry) * inv
        if (Math.abs(sx) > viewW / 2 + rad) continue
        // screen y = horizon - sy, so keep anything whose quad can reach the band
        // [0, viewH]; the bounds are not symmetric about the centre
        const sy = (ddx * ux + ddy * uy - camZ * uz) * inv
        if (sy < horizon - viewH - rad || sy > horizon + rad) continue
      }
      tiles.push({ d: depth, x: tx, y: ty })
    }
  tiles.sort((a, b) => b.d - a.d)
  const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const tile = (x: number, y: number): TileKind | null =>
    x < 0 || y < 0 || x >= world.w || y >= world.h ? null : world.tiles[y * world.w + x]

  // The spawn sits just inside the west wall. Carry the entry avenue a few
  // blocks past the map edge so the chase camera always has street beneath it
  // on the first frame instead of a blank foreground void.
  const entryY = world.spawn.y * TS
  // The near edge must stay in front of the camera: project() deliberately
  // clips anything behind its near plane, so starting behind the rig would
  // discard the whole apron instead of only its hidden edge.
  const entryX0 = camX + TS * 1.6
  const entryX1 = world.spawn.x * TS + TS * 2
  const entryCorners = [
    project(entryX0, entryY - TS * 1.5, 0),
    project(entryX1, entryY - TS * 1.5, 0),
    project(entryX1, entryY + TS * 1.5, 0),
    project(entryX0, entryY + TS * 1.5, 0),
  ]
  if (entryCorners.every((pt): pt is NonNullable<typeof pt> => pt !== null)) {
    const [a, b, c, d] = entryCorners
    quad(a, b, c, d, lit(r.road, floorMr, floorMg, floorMb))
    const at = (u: number, v: number) => lerpPt(lerpPt(a, b, u), lerpPt(d, c, u), v)
    // raised kerb paint lines on both edges, with a broken centre stripe
    const e0 = at(0, 0.045)
    const e1 = at(1, 0.045)
    const e2 = at(0, 0.955)
    const e3 = at(1, 0.955)
    quad(a, b, e1, e0, lit(lighten(r.road, 26), floorMr, floorMg, floorMb))
    quad(d, c, e3, e2, lit(lighten(r.road, 26), floorMr, floorMg, floorMb))
    for (let x = Math.ceil(entryX0 / TS); x < entryX1 / TS; x += 2) {
      const x0 = Math.max(entryX0, x * TS + TS * 0.18)
      const x1 = Math.min(entryX1, x * TS + TS * 0.76)
      const dash = [
        project(x0, entryY - TS * 0.035, 0),
        project(x1, entryY - TS * 0.035, 0),
        project(x1, entryY + TS * 0.035, 0),
        project(x0, entryY + TS * 0.035, 0),
      ]
      if (dash.every((pt) => pt !== null)) quad(dash[0]!, dash[1]!, dash[2]!, dash[3]!, withAlpha('#ffe9a8', 0.58))
    }
  }

  for (const t of tiles) {
    const x0 = t.x * TS
    const y0 = t.y * TS
    const x1 = x0 + TS
    const y1 = y0 + TS
    const a = project(x0, y0, 0)
    const b = project(x1, y0, 0)
    const c = project(x1, y1, 0)
    const d = project(x0, y1, 0)
    const kind = world.tiles[t.y * world.w + t.x]
    if (!a || !b || !c || !d) {
      const clipped = clipProjectPolygon([
        { x: x0, y: y0, z: 0 }, { x: x1, y: y0, z: 0 },
        { x: x1, y: y1, z: 0 }, { x: x0, y: y1, z: 0 },
      ])
      if (clipped.length >= 3) {
        ctx.fillStyle = lit(groundColor(t.x, t.y, kind), floorMr, floorMg, floorMb)
        ctx.beginPath()
        ctx.moveTo(clipped[0].x, clipped[0].y)
        for (let i = 1; i < clipped.length; i++) ctx.lineTo(clipped[i].x, clipped[i].y)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = ctx.fillStyle
        ctx.lineWidth = 1
        ctx.stroke()
      }
      continue
    }

    if (kind === 'water') {
      // a pond: deep blue carrying the sky's reflection, a highlight band that
      // drifts with the clock, and a stone kerb wherever it meets the paving
      const at = (u: number, v: number): Pt => lerpPt(lerpPt(a, b, u), lerpPt(d, c, u), v)
      quad(a, b, c, d, lit(mix('#1d4f78', skyHorizon, 0.45), floorMr, floorMg, floorMb))
      // a darker far half, so the water reads as a surface with depth
      quad(d, c, at(1, 0.45), at(0, 0.45), lit(mix('#153f60', skyHorizon, 0.3), floorMr, floorMg, floorMb))
      const ph = (now / 900 + (t.x * 0.7 + t.y * 1.3)) % 1
      const v0 = 0.12 + ph * 0.6
      const v1 = Math.min(0.94, v0 + 0.13)
      quad(at(0.1, v0), at(0.9, v0), at(0.9, v1), at(0.1, v1), withAlpha('#ffffff', 0.14))
      const kerb = lit(shade(r.road, -6), floorMr, floorMg, floorMb)
      if (tile(t.x, t.y - 1) !== 'water') quad(a, b, at(1, 0.16), at(0, 0.16), kerb)
      if (tile(t.x, t.y + 1) !== 'water') quad(d, c, at(1, 0.84), at(0, 0.84), kerb)
      if (tile(t.x - 1, t.y) !== 'water') quad(a, d, at(0.16, 1), at(0.16, 0), kerb)
      if (tile(t.x + 1, t.y) !== 'water') quad(b, c, at(0.84, 1), at(0.84, 0), kerb)
      continue
    }

    const col = lit(groundColor(t.x, t.y, kind), floorMr, floorMg, floorMb)
    quad(a, b, c, d, col)

    // City streets get a perspective-scaled lane rhythm. The stripe only runs
    // through the central lane tile, so the two outer lanes stay clean.
    if (kind === 'road') {
      const horizontal = tile(t.x - 1, t.y) === 'road' && tile(t.x + 1, t.y) === 'road'
      const vertical = tile(t.x, t.y - 1) === 'road' && tile(t.x, t.y + 1) === 'road'
      const centerLane = horizontal
        ? tile(t.x, t.y - 1) !== 'road' && tile(t.x, t.y + 1) !== 'road'
        : vertical && tile(t.x - 1, t.y) !== 'road' && tile(t.x + 1, t.y) !== 'road'
      if (centerLane && (horizontal ? t.x % 3 !== 1 : t.y % 3 !== 1)) {
        const at = (u: number, v: number): Pt => lerpPt(lerpPt(a, b, u), lerpPt(d, c, u), v)
        if (horizontal) quad(at(0.12, 0.46), at(0.82, 0.46), at(0.82, 0.54), at(0.12, 0.54), withAlpha('#ffe9a8', 0.56))
        else quad(at(0.46, 0.12), at(0.54, 0.12), at(0.54, 0.82), at(0.46, 0.82), withAlpha('#ffe9a8', 0.56))
      }
    }
  }

  /* ---- everything that stands up, sorted far to near -------------------- */
  type Item = { d: number; draw: () => void }
  const items: Item[] = []
  const litProp = (hex: string) => lit(hex, mr, mg, mb)

  // Forest clearings grow into the unused superblocks themselves: these
  // non-colliding canopy silhouettes make the archetype read as woodland in
  // first-person, even when the generated prop scatter is sparse.
  if (world.archetype.id === 'forest') {
    for (let y = 0; y < world.h; y++)
      for (let x = 0; x < world.w; x++) {
        if (world.tiles[y * world.w + x] !== 'park' || tileHash(x + 281, y + 97) < 0.82) continue
        const wx = (x + 0.5) * TS
        const wy = (y + 0.5) * TS
        const pt = project(wx, wy, 0)
        if (!pt || pt.depth <= NEAR * 1.5 || pt.depth > mapReach) continue
        items.push({
          d: pt.depth,
          draw: () => {
            ctx.save()
            ctx.translate(pt.x, pt.y)
            ctx.scale(Math.min(6, pt.s * 1.35), Math.min(6, pt.s * 1.35))
            drawTree3D(ctx, litProp, true)
            ctx.restore()
          },
        })
      }
  }

  for (const box of buildingBoxes(world)) {
    const d = Math.hypot(box.cx - camX, box.cy - camY)
    if (d > mapReach) continue
    items.push({ d, draw: () => drawBox(ctx, project, clipProjectPolygon, quad, box, camX, camY, camZ, world, mr, mg, mb, dayAmt, d) })
  }

  const solved = new Set(world.clues.slice(0, p.clueIndex).map((cl) => cl.propId))
  const nextClueId = world.clues[p.clueIndex]?.propId ?? -1
  const assisted = clueAssist(world.city, p.clueIndex)

  for (const pr of world.props) {
    if (pr.used && pr.kind === 'coin') continue
    const ddx = pr.x - camX
    const ddy = pr.y - camY
    if (ddx * ddx + ddy * ddy > maxD2) continue
    const pt = project(pr.x, pr.y, 0)
    if (!pt || pt.depth > mapReach || pt.depth <= NEAR * 1.5) continue
    const scale = Math.min(9, pt.s)
    const marks: PropMarks = { solved: solved.has(pr.id), isNext: pr.id === nextClueId, assisted, hasPass: p.hasPass }
    const isTree = pr.kind === 'tree'
    const isBush = pr.kind === 'bush'
    items.push({
      d: pt.depth,
      draw: () => {
        ctx.save()
        ctx.translate(pt.x, pt.y)
        ctx.scale(scale, scale)
        if (isTree) drawTree3D(ctx, litProp, world.archetype.id === 'forest')
        else if (isBush) drawBush3D(ctx, litProp)
        else if (pr.kind === 'fountain') drawFountain3D(ctx, litProp, now)
        else drawProp(ctx, { ...pr, x: 0, y: 0 }, world)
        drawPropBadges(ctx, { ...pr, x: 0, y: 0 }, marks)
        ctx.restore()
      },
    })
  }

  for (const gd of world.guards) {
    const ddx = gd.x - camX
    const ddy = gd.y - camY
    if (ddx * ddx + ddy * ddy > maxD2) continue
    const pt = project(gd.x, gd.y, 0)
    if (!pt || pt.depth > mapReach || pt.depth <= NEAR * 1.5) continue
    const scale = Math.min(9, pt.s)
    items.push({
      d: pt.depth,
      draw: () => {
        ctx.save()
        ctx.translate(pt.x, pt.y)
        ctx.scale(scale, scale)
        drawGuard(ctx, { ...gd, x: 0, y: 0 } as Guard, r)
        ctx.restore()
      },
    })
  }

  // the runner: the same mascot, drawn from behind (no face) while heading away
  // and from the front only when running back toward the camera
  const playerPt = project(p.x, p.y, 0)
  const facingAway = Math.cos(angleDiff(p.facing, yaw)) >= 0
  if (playerPt) {
    const scale = Math.min(8, playerPt.s) * 0.62
    items.push({
      d: playerPt.depth,
      draw: () => {
        ctx.save()
        ctx.translate(playerPt.x, playerPt.y)
        ctx.scale(scale, scale)
        drawCharacter(ctx, {
          x: 0,
          y: 0,
          facing: facingAway ? p.facing : p.facing + Math.PI,
          pose: p.pose,
          anim: p.moving ? p.anim / 3 : performance.now() / 550,
          skin: game.getSkin(),
          ghost: p.hidden,
          time: performance.now(),
          back: facingAway,
          noRim: true,
        })
        ctx.restore()
      },
    })
  }

  // the border gate: two stone posts and a crossbeam, with the doors shut while
  // the pass is missing and swung wide once the city is cleared
  {
    const open = p.hasPass
    const gateDist = Math.hypot((world.w - 1) * TS - camX, world.gate.y * TS - camY)
    items.push({ d: gateDist, draw: () => drawGate3D(ctx, project, world, open, (hex) => lit(hex, mr, mg, mb), now) })
  }

  items.sort((a, b) => b.d - a.d)
  for (const it of items) it.draw()

  /* ---- guard vision cones, laid flat on the street ---------------------- */
  for (const gd of world.guards) {
    const foot = project(gd.x, gd.y, 1)
    if (!foot) continue
    const chasing = gd.state === 'chase'
    const base = chasing ? [255, 60, 60] : gd.alert > 0.4 ? [255, 160, 60] : [255, 120, 120]
    const alpha = (chasing ? 0.28 : gd.alert > 0.4 ? 0.2 : 0.12) * (0.5 + amb * 0.5)
    const steps = 7
    const left = project(
      gd.x + Math.cos(gd.dir - gd.visionHalfAngle) * gd.visionDist,
      gd.y + Math.sin(gd.dir - gd.visionHalfAngle) * gd.visionDist,
      0,
    )
    const right = project(
      gd.x + Math.cos(gd.dir + gd.visionHalfAngle) * gd.visionDist,
      gd.y + Math.sin(gd.dir + gd.visionHalfAngle) * gd.visionDist,
      0,
    )
    if (!left || !right) continue
    ctx.save()
    ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${alpha})`
    ctx.beginPath()
    ctx.moveTo(foot.x, foot.y)
    ctx.lineTo(left.x, left.y)
    for (let i = 1; i <= steps; i++) {
      const a = gd.dir - gd.visionHalfAngle + (i / steps) * gd.visionHalfAngle * 2
      const pt = project(gd.x + Math.cos(a) * gd.visionDist, gd.y + Math.sin(a) * gd.visionDist, 0)
      if (pt) ctx.lineTo(pt.x, pt.y)
    }
    ctx.lineTo(right.x, right.y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /* ---- overlays --------------------------------------------------------- */
  if (game.hitFlash > 0) {
    const a = Math.min(1, game.hitFlash)
    const hurt = ctx.createRadialGradient(
      cxScreen,
      viewH / 2,
      Math.min(viewW, viewH) * 0.25,
      cxScreen,
      viewH / 2,
      Math.max(viewW, viewH) * 0.7,
    )
    hurt.addColorStop(0, 'rgba(255, 40, 70, 0)')
    hurt.addColorStop(1, `rgba(255, 30, 60, ${0.55 * a})`)
    ctx.fillStyle = hurt
    ctx.fillRect(0, 0, viewW, viewH)
  }

  if (assisted && !p.hasPass) {
    const prop = world.propAt.get(nextClueId)
    if (prop) {
      const rel = Math.atan2(prop.y - p.y, prop.x - p.x) - yaw
      // only nudge when the clue is off to one side; straight ahead it is
      // already in view, so no marker is drawn over the street
      if (Math.abs(rel) > 0.35) {
        const pulse = (Math.sin(now / 240) + 1) / 2
        ctx.save()
        ctx.translate(cxScreen, 40)
        ctx.rotate(rel)
        ctx.fillStyle = withAlpha(C.gold, 0.7 + pulse * 0.25)
        ctx.shadowColor = C.gold
        ctx.shadowBlur = 14
        ctx.beginPath()
        ctx.moveTo(0, -12)
        ctx.lineTo(-9, 6)
        ctx.lineTo(0, 1)
        ctx.lineTo(9, 6)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        const away = Math.max(1, Math.round(Math.hypot(prop.x - p.x, prop.y - p.y) / TS))
        ctx.font = `13px ${DISPLAY}`
        ctx.textAlign = 'center'
        ctx.lineWidth = 3.5
        ctx.strokeStyle = 'rgba(10, 6, 26, 0.85)'
        ctx.strokeText(String(away), cxScreen, 62)
        ctx.fillStyle = withAlpha(C.gold, 0.95)
        ctx.fillText(String(away), cxScreen, 62)
        ctx.textAlign = 'left'
      }
    }
  }

  if (p.hidden) {
    ctx.font = `15px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(10, 6, 26, 0.9)'
    ctx.strokeText('HIDDEN', cxScreen, viewH - 34)
    ctx.fillStyle = C.cyan
    ctx.fillText('HIDDEN', cxScreen, viewH - 34)
    ctx.textAlign = 'left'
  }
}

/* ------------------------------------------------------------------ */
/* a building block: two lit faces, a roof, and a window grid           */
/* ------------------------------------------------------------------ */

type Pt = { x: number; y: number }

function drawBox(
  ctx: CanvasRenderingContext2D,
  project: (x: number, y: number, z: number) => Pt & { s: number; depth: number } | null,
  clipProjectPolygon: (points: Array<{ x: number; y: number; z: number }>) => Pt[],
  quad: (a: Pt, b: Pt, c: Pt, d: Pt, color: string) => void,
  box: Box,
  camX: number,
  camY: number,
  camZ: number,
  world: World,
  mr: number,
  mg: number,
  mb: number,
  dayAmt: number,
  dist: number,
) {
  const H = box.h
  const r = world.region
  const type = world.archetype
  const x0 = box.x0 * TS
  const y0 = box.y0 * TS
  const x1 = box.x1 * TS
  const y1 = box.y1 * TS
  const p000 = project(x0, y0, 0)
  const p100 = project(x1, y0, 0)
  const p010 = project(x0, y1, 0)
  const p110 = project(x1, y1, 0)
  const t000 = project(x0, y0, H)
  const t100 = project(x1, y0, H)
  const t010 = project(x0, y1, H)
  const t110 = project(x1, y1, H)
  const complete = !!p000 && !!p100 && !!p010 && !!p110 && !!t000 && !!t100 && !!t010 && !!t110
  const face = (points: Array<{ x: number; y: number; z: number }>, color: string) => {
    const clipped = clipProjectPolygon(points)
    if (clipped.length < 3) return
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(clipped[0].x, clipped[0].y)
    for (let i = 1; i < clipped.length; i++) ctx.lineTo(clipped[i].x, clipped[i].y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
  }

  const surface = (hex: string) => lit(hex, mr, mg, mb)

  // the ring wall is plain stone; the city blocks are tinted by region
  const litWall = surface(box.plain ? shade(r.building, 34) : shade(r.buildingAlt, type.id === 'village' ? -8 : 2))
  const darkWall = surface(box.plain ? shade(r.building, 52) : shade(r.buildingAlt, type.id === 'ruins' ? 62 : 52))
  const roof = surface(box.plain ? lighten(shade(r.building, 30), 18) : lighten(r.building, 34))
  const roofDark = surface(type.id === 'village' ? shade(r.buildingAlt, -10) : shade(r.building, 4))

  // side faces, then the roof on top
  const north = camY < y0
  const south = camY > y1
  const west = camX < x0
  const east = camX > x1
  if (north) face([{ x: x0, y: y0, z: 0 }, { x: x1, y: y0, z: 0 }, { x: x1, y: y0, z: H }, { x: x0, y: y0, z: H }], darkWall)
  if (south) face([{ x: x0, y: y1, z: 0 }, { x: x1, y: y1, z: 0 }, { x: x1, y: y1, z: H }, { x: x0, y: y1, z: H }], litWall)
  if (west) face([{ x: x0, y: y0, z: 0 }, { x: x0, y: y1, z: 0 }, { x: x0, y: y1, z: H }, { x: x0, y: y0, z: H }], darkWall)
  if (east) face([{ x: x1, y: y0, z: 0 }, { x: x1, y: y1, z: 0 }, { x: x1, y: y1, z: H }, { x: x1, y: y0, z: H }], litWall)

  // a window grid on every face we can see, while reasonably close. Windows
  // glow warmer as the light drops, so an evening city reads through the night.
  if (!box.plain && dist < 21 * TS && complete) {
    const seed = Math.floor(box.cx * 3 + box.cy * 7)
    const windowTint =
      type.id === 'metro' ? r.neon2 :
      type.id === 'future' ? '#c8ffff' :
      type.id === 'forest' ? '#c5ff9c' :
      type.id === 'ruins' ? '#ffc46a' : '#ffe1a1'
    const winLit = withAlpha(windowTint, 0.62 + 0.32 * (1 - dayAmt))
    const winDark = withAlpha('#171330', 0.8)
    const columns = type.id === 'future' ? 6 : type.id === 'village' ? 3 : 4
    if (north) windowGrid(ctx, p000, p100, t100, t000, H, seed, winLit, winDark, columns)
    if (south) windowGrid(ctx, p010, p110, t110, t010, H, seed + 31, winLit, winDark, columns)
    if (west) windowGrid(ctx, p000, p010, t010, t000, H, seed + 61, winLit, winDark, columns)
    if (east) windowGrid(ctx, p100, p110, t110, t100, H, seed + 97, winLit, winDark, columns)
  }

  if (complete && !box.plain && type.id === 'future') {
    // Light rails trace the top corners and vertical mullions of the glass
    // towers, keeping the skyline legible even when the roof is above the camera.
    ctx.strokeStyle = withAlpha('#8cf7ff', 0.74)
    ctx.lineWidth = 2
    ctx.beginPath()
    if (north) {
      ctx.moveTo(t000.x, t000.y)
      ctx.lineTo(t100.x, t100.y)
      for (const u of [0.14, 0.86]) {
        const x = x0 + (x1 - x0) * u
        const base = project(x, y0, 0)
        const top = project(x, y0, H)
        if (base && top) {
          ctx.moveTo(base.x, base.y)
          ctx.lineTo(top.x, top.y)
        }
      }
    }
    if (south) {
      ctx.moveTo(t010.x, t010.y)
      ctx.lineTo(t110.x, t110.y)
      for (const u of [0.14, 0.86]) {
        const x = x0 + (x1 - x0) * u
        const base = project(x, y1, 0)
        const top = project(x, y1, H)
        if (base && top) {
          ctx.moveTo(base.x, base.y)
          ctx.lineTo(top.x, top.y)
        }
      }
    }
    if (west) {
      ctx.moveTo(t000.x, t000.y)
      ctx.lineTo(t010.x, t010.y)
    }
    if (east) {
      ctx.moveTo(t100.x, t100.y)
      ctx.lineTo(t110.x, t110.y)
    }
    ctx.stroke()
  }

  if (camZ > H && complete) {
    if (!box.plain && type.id === 'village') {
      // Low timber homes end in a pitched roof ridge, breaking the flat glass
      // skyline and giving even small village lots a recognizable silhouette.
      const ridgeY = (y0 + y1) / 2
      const ridgeLift = Math.max(10, H * 0.22)
      const ridge0 = project(x0, ridgeY, H + ridgeLift)
      const ridge1 = project(x1, ridgeY, H + ridgeLift)
      if (ridge0 && ridge1) {
        quad(t000, t100, ridge1, ridge0, roofDark)
        quad(t010, t110, ridge1, ridge0, roof)
        quad(t000, t010, ridge0, ridge0, roofDark)
        quad(t100, t110, ridge1, ridge1, roof)
        ctx.strokeStyle = withAlpha(r.neon, 0.55)
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(ridge0.x, ridge0.y)
        ctx.lineTo(ridge1.x, ridge1.y)
        ctx.stroke()
      } else quad(t000, t100, t110, t010, roof)
    } else {
      quad(t000, t100, t110, t010, roof)
    }

    if (!box.plain && type.id === 'future' && tileHash(Math.floor(box.cx), Math.floor(box.cy)) > 0.18) {
      // An inset upper floor turns a plaza block into a stepped glass tower.
      // The cap is generated from the same box footprint, so it stays stable
      // across frames and grows with the city type's skyline height.
      const insetX = Math.min(TS * 0.8, Math.max(TS * 0.22, (x1 - x0) * TS * 0.17))
      const insetY = Math.min(TS * 0.8, Math.max(TS * 0.22, (y1 - y0) * TS * 0.17))
      const z1 = H + Math.max(18, H * 0.28)
      const lowNW = project(x0 + insetX, y0 + insetY, H)
      const lowNE = project(x1 - insetX, y0 + insetY, H)
      const lowSW = project(x0 + insetX, y1 - insetY, H)
      const lowSE = project(x1 - insetX, y1 - insetY, H)
      const topNW = project(x0 + insetX, y0 + insetY, z1)
      const topNE = project(x1 - insetX, y0 + insetY, z1)
      const topSW = project(x0 + insetX, y1 - insetY, z1)
      const topSE = project(x1 - insetX, y1 - insetY, z1)
      if (lowNW && lowNE && lowSW && lowSE && topNW && topNE && topSW && topSE) {
        if (north) quad(lowNW, lowNE, topNE, topNW, surface(shade(r.buildingAlt, 2)))
        if (south) quad(lowSW, lowSE, topSE, topSW, surface(lighten(r.buildingAlt, 12)))
        if (west) quad(lowNW, lowSW, topSW, topNW, surface(shade(r.buildingAlt, 18)))
        if (east) quad(lowNE, lowSE, topSE, topNE, surface(lighten(r.buildingAlt, 18)))
        quad(topNW, topNE, topSE, topSW, surface(lighten(r.building, 46)))
        const glow = withAlpha('#c8ffff', 0.92)
        const capDark = withAlpha('#173341', 0.78)
        if (north) windowGrid(ctx, lowNW, lowNE, topNE, topNW, z1 - H, 100 + Math.floor(box.cx), glow, capDark, 4)
        if (south) windowGrid(ctx, lowSW, lowSE, topSE, topSW, z1 - H, 170 + Math.floor(box.cy), glow, capDark, 4)
        // a fine crown light catches the tower edge against the sky
        ctx.strokeStyle = withAlpha(r.neon2, 0.78)
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(topNW.x, topNW.y)
        ctx.lineTo(topNE.x, topNE.y)
        ctx.lineTo(topSE.x, topSE.y)
        ctx.lineTo(topSW.x, topSW.y)
        ctx.closePath()
        ctx.stroke()
      }
    } else if (!box.plain && type.id === 'metro' && tileHash(Math.floor(box.cx), Math.floor(box.cy) + 11) > 0.52) {
      // Metro rooftops carry a few needle antennas and cyan beacons.
      const base = project((x0 + x1) / 2, (y0 + y1) / 2, H)
      const tip = project((x0 + x1) / 2, (y0 + y1) / 2, H + TS * 0.72)
      if (base && tip) {
        ctx.strokeStyle = withAlpha(r.neon2, 0.82)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(base.x, base.y)
        ctx.lineTo(tip.x, tip.y)
        ctx.stroke()
        ctx.fillStyle = withAlpha(r.neon, 0.9)
        ctx.beginPath()
        ctx.arc(tip.x, tip.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (!box.plain && type.id === 'ruins' && tileHash(Math.floor(box.cx) + 71, Math.floor(box.cy)) > 0.22) {
      // Broken roof slabs, exposed seams and scattered debris make the rubble
      // district look abandoned rather than like another intact concrete set.
      const crackA = project(x0 + (x1 - x0) * 0.18, y0 + (y1 - y0) * 0.42, H + 1)
      const crackB = project(x0 + (x1 - x0) * 0.43, y0 + (y1 - y0) * 0.56, H + 1)
      const crackC = project(x0 + (x1 - x0) * 0.62, y0 + (y1 - y0) * 0.35, H + 1)
      if (crackA && crackB && crackC) {
        ctx.strokeStyle = withAlpha('#262326', 0.55)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(crackA.x, crackA.y)
        ctx.lineTo(crackB.x, crackB.y)
        ctx.lineTo(crackC.x, crackC.y)
        ctx.stroke()
        ctx.fillStyle = surface(shade(r.buildingAlt, -8))
        ctx.fillRect(crackB.x + 3, crackB.y - 3, 7, 3)
      }
    }

    // parapet ring
    ctx.strokeStyle = withAlpha(r.neon2, 0.4)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(t000.x, t000.y)
    ctx.lineTo(t100.x, t100.y)
    ctx.lineTo(t110.x, t110.y)
    ctx.lineTo(t010.x, t010.y)
    ctx.closePath()
    ctx.stroke()
  } else if (camZ > H) {
    face([{ x: x0, y: y0, z: H }, { x: x1, y: y0, z: H }, { x: x1, y: y1, z: H }, { x: x0, y: y1, z: H }], roof)
  }
}

/** lay a rows x cols window grid across a wall quad by bilinear interpolation */
function windowGrid(
  ctx: CanvasRenderingContext2D,
  bl: Pt,
  br: Pt,
  tr: Pt,
  tl: Pt,
  height: number,
  seed: number,
  litColor: string,
  darkColor: string,
  cols = 4,
) {
  const rows = Math.max(1, Math.round(height / 22))
  const mx = 0.22 / cols
  const my = 0.18 / rows
  const at = (u: number, v: number): Pt => {
    const bx = bl.x + (br.x - bl.x) * u
    const by = bl.y + (br.y - bl.y) * u
    const tx = tl.x + (tr.x - tl.x) * u
    const ty = tl.y + (tr.y - tl.y) * u
    return { x: bx + (tx - bx) * v, y: by + (ty - by) * v }
  }
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const u0 = col / cols + mx
      const u1 = (col + 1) / cols - mx
      const v0 = row / rows + my
      const v1 = (row + 1) / rows - my
      const a = at(u0, v0)
      const b = at(u1, v0)
      const c = at(u1, v1)
      const d = at(u0, v1)
      const on = tileHash(seed + col * 13, row * 7) > 0.45
      ctx.fillStyle = on ? litColor : darkColor
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(c.x, c.y)
      ctx.lineTo(d.x, d.y)
      ctx.closePath()
      ctx.fill()
    }
}

/* ------------------------------------------------------------------ */
/* trees and bushes as real billboards, not circles                     */
/* ------------------------------------------------------------------ */

function drawTree3D(ctx: CanvasRenderingContext2D, lit: (hex: string) => string, conifer = false) {
  // trunk
  ctx.fillStyle = lit('#5b3d26')
  ctx.beginPath()
  ctx.moveTo(-3, 0)
  ctx.lineTo(-2.4, -24)
  ctx.lineTo(2.4, -24)
  ctx.lineTo(3, 0)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = lit('#3c2718')
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, -2)
  ctx.lineTo(0, -22)
  ctx.stroke()

  if (conifer) {
    // Layered pointed boughs make the forest skyline read as pine canopy,
    // distinct from the round street trees in denser urban districts.
    const tiers: Array<[number, number, number, string]> = [
      [-48, 14, 0, '#1e5536'],
      [-39, 19, 1, '#286d42'],
      [-29, 24, 2, '#368754'],
    ]
    for (const [top, half, drift, color] of tiers) {
      ctx.fillStyle = lit(color)
      ctx.beginPath()
      ctx.moveTo(drift, top)
      ctx.lineTo(drift + half, top + half * 1.25)
      ctx.lineTo(drift - half, top + half * 1.25)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = lit('#7dba78')
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(drift, top + 5)
      ctx.lineTo(drift - half * 0.52, top + half * 0.92)
      ctx.stroke()
    }
    return
  }

  // canopy: stacked, shaded blobs, lighter at the top so it has volume
  const blobs: Array<[number, number, number, number]> = [
    [0, -30, 15, 12],
    [-8, -40, 12, 10],
    [9, -40, 11, 9],
    [0, -50, 12, 10],
    [-4, -58, 8, 7],
    [5, -57, 8, 7],
  ]
  for (const [bx, by, rw, rh] of blobs) {
    ctx.fillStyle = lit('#2f6b45')
    ctx.beginPath()
    ctx.ellipse(bx, by + 2, rw, rh, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = lit('#3f8f5c')
    ctx.beginPath()
    ctx.ellipse(bx, by - 1, rw * 0.9, rh * 0.9, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = lit('#63b47e')
  ctx.beginPath()
  ctx.ellipse(-4, -44, 8, 6, -0.3, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * The border gate: two stone posts under a crossbeam, with a doorway between
 * them. Shut and locked until every clue is found, then the doors fold back and
 * a gold passage glows through, so the way to the next city is unmistakable.
 */
function drawGate3D(
  ctx: CanvasRenderingContext2D,
  project: (x: number, y: number, z: number) => (Pt & { s: number; depth: number }) | null,
  world: World,
  open: boolean,
  tint: (hex: string) => string,
  now: number,
) {
  const xEdge = (world.w - 1) * TS
  const yMid = world.gate.y * TS
  const yA = yMid - TS * 1.25
  const yB = yMid + TS * 1.25
  const H = TS * 2.2
  const bA = project(xEdge, yA, 0)
  const tA = project(xEdge, yA, H)
  const bB = project(xEdge, yB, 0)
  const tB = project(xEdge, yB, H)
  const tAp = project(xEdge, yA, H * 0.82)
  const tBp = project(xEdge, yB, H * 0.82)
  if (!bA || !tA || !bB || !tB || !tAp || !tBp) return

  const stone = tint('#8f86b8')
  const stoneDark = tint('#544d78')
  const postW = Math.max(3, tA.s * 0.75)

  const bar = (b: Pt, t: Pt, w: number, fill: string) => {
    const dx = t.x - b.x
    const dy = t.y - b.y
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * (w / 2)
    const ny = (dx / len) * (w / 2)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(b.x + nx, b.y + ny)
    ctx.lineTo(t.x + nx, t.y + ny)
    ctx.lineTo(t.x - nx, t.y - ny)
    ctx.lineTo(b.x - nx, b.y - ny)
    ctx.closePath()
    ctx.fill()
  }

  // crossbeam across the top
  bar(tA, tB, Math.max(4, tA.s), stoneDark)

  // the doorway
  ctx.beginPath()
  ctx.moveTo(bA.x, bA.y)
  ctx.lineTo(bB.x, bB.y)
  ctx.lineTo(tBp.x, tBp.y)
  ctx.lineTo(tAp.x, tAp.y)
  ctx.closePath()
  if (open) {
    ctx.fillStyle = 'rgba(12, 8, 28, 0.72)'
    ctx.fill()
    const glow = ctx.createLinearGradient(bA.x, bA.y, tAp.x, tAp.y)
    glow.addColorStop(0, withAlpha(C.gold, 0.4 + 0.16 * Math.sin(now / 300)))
    glow.addColorStop(1, withAlpha(C.gold, 0.02))
    ctx.fillStyle = glow
    ctx.fill()
    // leaves folded back against each post
    ctx.strokeStyle = stoneDark
    ctx.lineWidth = Math.max(2, tA.s * 0.5)
    ctx.beginPath()
    ctx.moveTo(bA.x, bA.y)
    ctx.lineTo(bA.x - postW * 2.4, bA.y - postW * 0.5)
    ctx.moveTo(bB.x, bB.y)
    ctx.lineTo(bB.x - postW * 2.4, bB.y + postW * 0.5)
    ctx.stroke()
  } else {
    const door = ctx.createLinearGradient(bA.x, 0, bB.x, 0)
    door.addColorStop(0, stoneDark)
    door.addColorStop(1, tint('#3a3458'))
    ctx.fillStyle = door
    ctx.fill()
    // warning stripes down each door
    ctx.strokeStyle = withAlpha('#ff5470', 0.5)
    ctx.lineWidth = Math.max(2, tA.s * 0.35)
    ctx.beginPath()
    ctx.moveTo(bA.x, bA.y)
    ctx.lineTo(tAp.x, tAp.y)
    ctx.moveTo(bB.x, bB.y)
    ctx.lineTo(tBp.x, tBp.y)
    ctx.stroke()
    // a padlock badge in the middle
    ctx.fillStyle = tint('#ffd24a')
    const lx = (bA.x + bB.x) / 2
    const ly = (bA.y + bB.y) / 2 - postW * 1.6
    ctx.beginPath()
    ctx.arc(lx, ly, Math.max(2.5, tA.s * 0.5), 0, Math.PI * 2)
    ctx.fill()
  }

  // posts in front of the doors
  bar(bA, tA, postW, stone)
  bar(bB, tB, postW, stone)

  // sign over the gate
  const label = open ? 'EXIT' : 'LOCKED'
  const sx = (tA.x + tB.x) / 2
  const sy = (tA.y + tB.y) / 2 - Math.max(6, tA.s)
  ctx.font = `${Math.max(11, Math.round(tA.s * 1.6))}px ${DISPLAY}`
  ctx.textAlign = 'center'
  ctx.lineWidth = 3.5
  ctx.strokeStyle = 'rgba(10, 6, 26, 0.85)'
  ctx.strokeText(label, sx, sy)
  ctx.fillStyle = open ? C.gold : '#e6dffb'
  ctx.fillText(label, sx, sy)
  ctx.textAlign = 'left'
}

/**
 * A fountain with real depth: a stone basin seen as an ellipse of water inside a
 * raised rim, a pedestal carrying a second bowl, and jets that arc out of the
 * top and splash back into the pool. The water colour follows the sky, so it
 * reads as water at any hour, and the whole thing is lit by the same light as
 * everything else on the street.
 */
function drawFountain3D(ctx: CanvasRenderingContext2D, lit: (hex: string) => string, now: number) {
  const stone = lit('#c9c2e0')
  const stoneDark = lit('#8d84ad')
  const stoneDeep = lit('#5d557d')
  const water = lit('#2f7fb8')
  const waterLit = lit('#7fd0f0')

  // splash pool shadow on the paving
  ctx.fillStyle = 'rgba(8, 5, 22, 0.28)'
  ctx.beginPath()
  ctx.ellipse(0, 2, 20, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  // outer rim: a raised stone ring, built as two ellipses with a shaded band
  ctx.fillStyle = stoneDark
  ctx.beginPath()
  ctx.ellipse(0, 0, 19, 6.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = stone
  ctx.beginPath()
  ctx.ellipse(0, -1.6, 19, 6.6, 0, 0, Math.PI * 2)
  ctx.fill()

  // the water surface inside the rim
  ctx.fillStyle = water
  ctx.beginPath()
  ctx.ellipse(0, -1.6, 14.5, 4.6, 0, 0, Math.PI * 2)
  ctx.fill()
  // a lighter half, so the surface has a sheen rather than a flat fill
  ctx.fillStyle = waterLit
  ctx.beginPath()
  ctx.ellipse(-2.5, -2.6, 10, 2.6, 0, 0, Math.PI * 2)
  ctx.fill()

  // pedestal
  ctx.fillStyle = stoneDark
  ctx.beginPath()
  ctx.moveTo(-4, -2)
  ctx.lineTo(4, -2)
  ctx.lineTo(3, -16)
  ctx.lineTo(-3, -16)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = stone
  ctx.beginPath()
  ctx.moveTo(-3.4, -2)
  ctx.lineTo(0, -2)
  ctx.lineTo(0, -16)
  ctx.lineTo(-2.6, -16)
  ctx.closePath()
  ctx.fill()

  // upper bowl
  ctx.fillStyle = stoneDark
  ctx.beginPath()
  ctx.ellipse(0, -16, 9.5, 3.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = stone
  ctx.beginPath()
  ctx.ellipse(0, -17.4, 9.5, 3.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = waterLit
  ctx.beginPath()
  ctx.ellipse(0, -17.4, 7, 2.3, 0, 0, Math.PI * 2)
  ctx.fill()

  // a finial on top, then the jets arcing out of it
  ctx.fillStyle = stoneDeep
  ctx.beginPath()
  ctx.moveTo(-1.8, -18)
  ctx.lineTo(1.8, -18)
  ctx.lineTo(0, -25)
  ctx.closePath()
  ctx.fill()

  const t = now / 520
  ctx.strokeStyle = withAlpha('#dff4ff', 0.75)
  ctx.lineWidth = 1.4
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + t * 0.35
    const spread = 8 + Math.sin(t + i) * 1.6
    ctx.beginPath()
    ctx.moveTo(0, -24)
    ctx.quadraticCurveTo(Math.cos(a) * spread * 0.5, -26, Math.cos(a) * spread, -18)
    ctx.stroke()
  }

  // falling droplets, so the water is visibly moving
  ctx.fillStyle = withAlpha('#eaf9ff', 0.8)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + t * 0.5
    const r = 12 + (i % 3) * 2
    const fall = ((t * 14 + i * 3) % 10) / 10
    ctx.beginPath()
    ctx.arc(Math.cos(a) * r, -6 + fall * 6, 1.1, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawBush3D(ctx: CanvasRenderingContext2D, lit: (hex: string) => string) {
  const blobs: Array<[number, number, number]> = [
    [-8, -8, 9],
    [8, -8, 9],
    [0, -12, 11],
    [0, -4, 10],
  ]
  for (const [bx, by, rad] of blobs) {
    ctx.fillStyle = lit('#2f6b45')
    ctx.beginPath()
    ctx.ellipse(bx, by + 2, rad, rad * 0.85, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = lit('#3f8f5c')
  ctx.beginPath()
  ctx.ellipse(-2, -12, 9, 7, 0, 0, Math.PI * 2)
  ctx.fill()
}
