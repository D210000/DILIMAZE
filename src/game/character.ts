import { skinById, type CharacterPose, type Skin } from './brand'

/**
 * Character rendering — the ONLY place the player avatar is drawn.
 *
 * Everything game-logic side goes through `drawCharacter()`. To ship a real
 * Dlicom sprite sheet later, set `sprite` on the skin in brand.ts (url, frame
 * size, cols, fps, poseRows) and this file blits frames instead of drawing the
 * procedural mascot. No gameplay code or call site changes.
 */

export interface CharacterDrawOptions {
  x: number
  y: number
  /** radians; -x faces left, +x faces right */
  facing: number
  pose: CharacterPose
  /** animation clock in seconds (drives run/idle cycles) */
  anim: number
  skin: Skin | string
  /** hidden in a bush: drawn faded and see-through */
  ghost?: boolean
  /** wall-clock ms, used for the cape flutter (falls back to anim) */
  time?: number
  /** overall size multiplier */
  scale?: number
  /**
   * Draw the same mascot from behind: the shipped art is a single front facing
   * frame, so the face is covered with the suit's own colour (the same trick the
   * blink uses). Same body, same feet, same claws, no eyes.
   */
  back?: boolean
  /** skip the soft white rim light (used by the street camera) */
  noRim?: boolean
}

/** images are cached per URL so we never re-decode every frame */
const imageCache = new Map<string, HTMLImageElement>()

function imageFor(url: string): HTMLImageElement | null {
  let img = imageCache.get(url)
  if (!img) {
    if (typeof Image === 'undefined') return null
    img = new Image()
    img.src = url
    imageCache.set(url, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

function spriteFor(skin: Skin): HTMLImageElement | null {
  return skin.sprite ? imageFor(skin.sprite.url) : null
}

/**
 * Cached recolored copy of a piece of art: same pixels, new hue/saturation
 * (canvas 'color' blend keeps the original shading). Returns the source image
 * untouched when the blend mode isn't supported by this browser.
 */
const tintCache = new Map<string, HTMLCanvasElement>()
/** the art's flat suit colour, sampled once per skin (used for the blink lid) */
const lidCache = new Map<string, string>()
const SUIT_SAMPLE = { x: 29, y: 20 } // plain suit pixels between the eyes

function lidColorFor(skin: Skin, source: CanvasImageSource, img: HTMLImageElement): string {
  const key = skin.tint ?? 'raw'
  const cached = lidCache.get(key)
  if (cached) return cached
  let color = '#1d6dff'
  if (source !== img) {
    try {
      const g = (source as HTMLCanvasElement).getContext('2d')
      const d = g?.getImageData(SUIT_SAMPLE.x, SUIT_SAMPLE.y, 1, 1).data
      if (d && d[3] > 180) color = `rgb(${d[0]}, ${d[1]}, ${d[2]})`
    } catch {
      /* cross-origin or detached canvas: keep the default blue */
    }
  }
  lidCache.set(key, color)
  return color
}

function tintedArt(url: string, tint: string, img: HTMLImageElement): CanvasImageSource {
  const key = `${url}|${tint}`
  const cached = tintCache.get(key)
  if (cached) return cached
  if (typeof document === 'undefined') return img
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')
  if (!g) return img
  g.drawImage(img, 0, 0)
  g.globalCompositeOperation = 'color' // hue + saturation from the fill, shading from the art
  if (g.globalCompositeOperation !== 'color') return img
  g.fillStyle = tint
  g.fillRect(0, 0, c.width, c.height)
  // the blend flattens alpha, so re-apply the art's own mask: no tinted box behind it
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(img, 0, 0)
  g.globalCompositeOperation = 'source-over'
  tintCache.set(key, c)
  return c
}

/**
 * Draw the shipped single-frame art, posed procedurally: it has no animation
 * frames, so bob / lean / squash / rotation do the acting instead.
 * Returns false while the image is still loading (caller falls back).
 */
function drawFromImage(ctx: CanvasRenderingContext2D, skin: Skin, o: CharacterDrawOptions): boolean {
  const art = skin.image!
  const img = imageFor(art.url)
  if (!img) return false
  const source = skin.tint ? tintedArt(art.url, skin.tint, img) : img
  const artH = art.height
  const artW = (img.naturalWidth / img.naturalHeight) * artH
  const t = (o.time ?? 0) / 1000
  const clock = o.anim || t

  // --- slice map, measured from the art (58x44) -----------------------------
  // body + head + eyes + claws: rows 0-35 (full width)
  // left foot: x 8-23, right foot: x 34-50, both rows 33-44
  // eyes: dark almonds centred at (19, 11) and (38.5, 11), body blue at (29, 20)
  const natW = img.naturalWidth
  const natH = img.naturalHeight
  const k = artH / natH // world px per art px
  const s = o.scale ?? 1
  const flip = Math.cos(o.facing) < 0 ? -1 : 1
  const p = o.pose
  const BODY_ROWS = 36
  const FOOT_L = { x: 8, y: 33, w: 16, h: 11 }
  const FOOT_R = { x: 34, y: 33, w: 17, h: 11 }

  // walk cycle: the feet take turns, and one is always planted — no hovering
  const stride = Math.sin(clock * 3.6)
  const stepL = p === 'run' ? stride : 0
  const stepR = p === 'run' ? -stride : 0
  // body dips on each footfall instead of drifting up and down
  const dip =
    p === 'run' ? Math.abs(Math.sin(clock * 3.6)) * 1.2 : p === 'idle' ? (Math.sin(clock * 2.2) + 1) * 0.55 : 0

  let lean = 0
  let rotate = 0
  let squashY = 1
  let squashX = 1
  let lift = 0
  switch (p) {
    case 'crouch':
      squashY = 0.66
      squashX = 1.1
      break
    case 'climb':
      lift = -8
      rotate = 0.16 + Math.sin(clock * 6) * 0.06
      break
    case 'sleep':
      rotate = -Math.PI / 2.15
      lift = 3
      squashY = 0.94
      break
    case 'interact':
      lift = Math.sin(clock * 7) * 1.1 - 1
      lean = 0.09
      break
  }
  const airborne = p === 'climb'

  // grounded shadow: tight and dark when he's standing, soft when he's off the floor
  ctx.save()
  ctx.fillStyle = airborne ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.4)'
  ctx.beginPath()
  ctx.ellipse(
    o.x,
    o.y + 1,
    artW * (p === 'crouch' ? 0.4 : airborne ? 0.26 : 0.34),
    artH * (airborne ? 0.06 : 0.085),
    0,
    0,
    Math.PI * 2,
  )
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(o.x, o.y + lift)
  if (o.ghost) ctx.globalAlpha = 0.45
  ctx.scale(flip, 1)
  ctx.rotate(rotate)
  ctx.translate(lean * artH * 0.35, 0)
  ctx.scale(s * squashX, s * squashY)
  ctx.imageSmoothingEnabled = false // pixel art stays crisp

  // rim light: a soft white glow around the silhouette so the hero reads on
  // bright neon pavement just as well as in a dark alley
  if (!o.noRim) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)'
    ctx.shadowBlur = 6
  }

  // body slab (the feet are drawn separately, on top)
  ctx.drawImage(source, 0, 0, natW, BODY_ROWS, -artW / 2, -artH + dip, artW, BODY_ROWS * k)
  ctx.shadowBlur = 0 // eye glints stay crisp, not haloed

  // seen from behind, the face is covered with the suit's own colour. A rounded
  // slab over the whole eye band hides the eyes cleanly while leaving the head
  // silhouette (the art's outline) intact around the edge.
  if (o.back) {
    ctx.fillStyle = lidColorFor(skin, source, img)
    roundRect(ctx, -artW / 2 + 1.5, -artH + dip + 1.5 * k, artW - 3, 20 * k, 6 * k)
    ctx.fill()
  }

  // --- eyes: roll with the direction of travel and blink now and then -------
  // local +x is always "forward" (the facing flip handles mirroring), so the eyes
  // lead the direction of travel instead of staring backwards when he faces left
  const lookX = p === 'idle' ? Math.sin(clock * 0.7) * 0.75 : p === 'run' ? 1.15 : 0.9
  const lookY = p === 'idle' ? Math.cos(clock * 0.45) * 0.4 : Math.sin(o.facing) * 0.7
  const blinking = p !== 'sleep' && Math.sin(t * 1.5) > 0.985
  const eyeY = -artH + 11 * k + dip
  const glint = (artX: number) => {
    const ex = -artW / 2 + artX * k
    if (o.back || blinking) {
      // eyelid: a slab of the suit's own colour over the eye
      ctx.fillStyle = lidColorFor(skin, source, img)
      ctx.beginPath()
      ctx.ellipse(ex, eyeY, 5.6 * k, 5.4 * k, 0, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.beginPath()
    ctx.arc(ex + lookX * 2.1 * k, eyeY + lookY * 1.5 * k, 1.5 * k * Math.max(0.7, s), 0, Math.PI * 2)
    ctx.fill()
  }
  if (!o.back) {
    glint(19)
    glint(38.5)
  }

  // feet: lift and push alternately, always touching the floor otherwise
  ctx.shadowBlur = 6 // the boots get the same rim so they don't melt into the road
  const foot = (box: { x: number; y: number; w: number; h: number }, step: number) => {
    const up = step > 0 ? -step * 3.4 : 0
    const push = step * 1.6
    ctx.drawImage(
      source,
      box.x,
      box.y,
      box.w,
      box.h,
      -artW / 2 + box.x * k + push,
      -artH + box.y * k + up,
      box.w * k,
      box.h * k,
    )
  }
  foot(FOOT_L, stepL)
  foot(FOOT_R, stepR)

  ctx.restore()

  if (o.pose === 'interact') drawEmote(ctx, clock)
  return true
}

/** Blit one frame of an animated sheet. Returns false when it isn't ready yet. */
function drawFromSheet(ctx: CanvasRenderingContext2D, skin: Skin, o: CharacterDrawOptions): boolean {
  const sheet = skin.sprite!
  const img = spriteFor(skin)
  if (!img) return false
  const row = sheet.poseRows[o.pose] ?? sheet.poseRows.idle ?? 0
  const col = Math.floor(o.anim * sheet.fps) % Math.max(1, sheet.cols)
  const s = o.scale ?? 1
  const w = sheet.frameW * s
  const h = sheet.frameH * s
  ctx.save()
  ctx.translate(o.x, o.y)
  if (Math.cos(o.facing) < 0) ctx.scale(-1, 1)
  ctx.globalAlpha = o.ghost ? 0.45 : 1
  ctx.drawImage(img, col * sheet.frameW, row * sheet.frameH, sheet.frameW, sheet.frameH, -w / 2, -h, w, h)
  ctx.restore()
  return true
}

/**
 * Draw the player. `x, y` is the character's feet (ground contact point).
 */
export function drawCharacter(ctx: CanvasRenderingContext2D, o: CharacterDrawOptions) {
  const skin = typeof o.skin === 'string' ? skinById(o.skin) : o.skin
  // real art first (animated sheet > single image), canvas drawing as fallback
  if (skin.sprite && drawFromSheet(ctx, skin, o)) return
  if (skin.image && drawFromImage(ctx, skin, o)) return

  const t = (o.time ?? 0) / 1000
  const clock = o.anim || t
  const s = o.scale ?? 1
  const faceRight = Math.cos(o.facing) >= 0
  const moving = o.pose === 'run'
  const bob = o.pose === 'idle' ? Math.sin(clock * 2.2) * 0.9 : moving ? Math.sin(clock * 2.4) * 1.6 : 0
  const swing = moving ? Math.sin(clock * 2.4) : 0

  ctx.save()
  ctx.translate(o.x, o.y)
  ctx.globalAlpha = o.ghost ? 0.4 : 1

  // ground shadow (never scaled with the body pose, so it stays planted)
  ctx.fillStyle = 'rgba(0,0,0,0.34)'
  ctx.beginPath()
  ctx.ellipse(0, 0, 9 * s, 3.6 * s, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.scale(faceRight ? s : -s, s)

  if (o.pose === 'sleep') {
    drawSleeping(ctx, skin, clock)
    ctx.restore()
    return
  }

  if (o.pose === 'crouch') {
    ctx.translate(0, 4)
    ctx.scale(1.06, 0.66)
  }
  if (o.pose === 'climb') ctx.translate(0, 2)

  const capeFlutter = Math.sin(t * 3.4) * 2 + (moving ? 2.4 : 0)

  // cape sits behind the body when facing the camera, in front when turned away
  drawCape(ctx, skin, capeFlutter, bob)

  const legLift = o.pose === 'climb' ? 5 : 0
  const back = o.back === true
  drawLeg(ctx, skin, -3.4, bob, swing * 3.4 - legLift)
  drawLeg(ctx, skin, 3.4, bob, -swing * 3.4 - legLift)
  drawBody(ctx, skin, bob, back)
  drawArm(ctx, skin, -1, bob, -swing * 4, o.pose)
  drawArm(ctx, skin, 1, bob, swing * 4, o.pose)
  drawHelmet(ctx, skin, bob, o.pose, clock, back)

  if (o.pose === 'interact') drawEmote(ctx, clock)

  ctx.restore()
}

/* ---------------------------------------------------------------- */
/* pieces, all in local coords with (0,0) at the feet               */
/* ---------------------------------------------------------------- */

function drawLeg(ctx: CanvasRenderingContext2D, skin: Skin, x: number, bob: number, swing: number) {
  ctx.strokeStyle = skin.suitDark
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x * 0.6, -13 + bob)
  ctx.lineTo(x + swing * 0.5, -6 + bob)
  ctx.stroke()
  // boot
  ctx.fillStyle = skin.trim
  roundRect(ctx, x + swing * 0.5 - 3.4, -7.5 + bob, 7, 7.5, 2.6)
  ctx.fill()
  ctx.strokeStyle = skin.trimShade
  ctx.lineWidth = 0.8
  ctx.stroke()
}

function drawBody(ctx: CanvasRenderingContext2D, skin: Skin, bob: number, back = false) {
  const g = ctx.createLinearGradient(-9, -27, 9, -12)
  g.addColorStop(0, skin.suitLight)
  g.addColorStop(0.45, skin.suit)
  g.addColorStop(1, skin.suitDark)
  ctx.fillStyle = g
  roundRect(ctx, -8.4, -26 + bob, 16.8, 14.5, 7)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1
  ctx.stroke()

  // glossy sheen down the left side of the suit
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.ellipse(-4.4, -21 + bob, 2.1, 5.2, -0.2, 0, Math.PI * 2)
  ctx.fill()

  // chest emblem "D" (front only; the back of the suit carries a seam instead)
  if (back) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, -25 + bob)
    ctx.lineTo(0, -12 + bob)
    ctx.stroke()
    return
  }
  ctx.fillStyle = skin.emblem
  ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('D', 0, -18.6 + bob)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawArm(ctx: CanvasRenderingContext2D, skin: Skin, side: number, bob: number, swing: number, pose: CharacterPose) {
  const shoulderX = side * 7.4
  const shoulderY = -23.5 + bob
  let handX = shoulderX + side * 3.2 + swing * 0.6
  let handY = -15.5 + bob + Math.abs(swing) * 0.2
  if (pose === 'interact' && side > 0) {
    handX = 12
    handY = -20 + bob
  }
  if (pose === 'climb') {
    handX = side * 5.5
    handY = -32 + bob
  }
  ctx.strokeStyle = skin.suit
  ctx.lineWidth = 3.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(shoulderX, shoulderY)
  ctx.lineTo(handX, handY)
  ctx.stroke()
  // glove
  ctx.fillStyle = skin.trim
  ctx.beginPath()
  ctx.arc(handX, handY, 2.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = skin.trimShade
  ctx.lineWidth = 0.7
  ctx.stroke()
}

function drawCape(ctx: CanvasRenderingContext2D, skin: Skin, flutter: number, bob: number) {
  const g = ctx.createLinearGradient(0, -28, 0, -4)
  g.addColorStop(0, skin.accent)
  g.addColorStop(1, skin.suitDark)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-6.4, -26 + bob)
  ctx.quadraticCurveTo(-15 - flutter, -19 + bob, -13 - flutter * 1.4, 0 + bob)
  ctx.quadraticCurveTo(-5, -7 + bob, 2, -6 + bob)
  ctx.quadraticCurveTo(7.4, -14 + bob, 7.4, -26 + bob)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 0.9
  ctx.stroke()
  // inner fold, so the cape reads as cloth rather than a blob
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.moveTo(-4.6, -25 + bob)
  ctx.quadraticCurveTo(-9 - flutter, -18 + bob, -8 - flutter, -3 + bob)
  ctx.quadraticCurveTo(-4, -9 + bob, -1, -8 + bob)
  ctx.closePath()
  ctx.fill()
}

function drawHelmet(
  ctx: CanvasRenderingContext2D,
  skin: Skin,
  bob: number,
  pose: CharacterPose,
  clock: number,
  back = false,
) {
  const cy = -33 + bob
  const r = 8.6

  // glass bubble
  const g = ctx.createRadialGradient(-2.6, cy - 3.4, 1.4, 0, cy, r * 1.25)
  g.addColorStop(0, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.55, skin.visor)
  g.addColorStop(1, 'rgba(255,255,255,0.08)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = skin.trim
  ctx.lineWidth = 1.5
  ctx.stroke()

  // the rear of the helmet is solid: no face, just a seam and a glint
  if (back) {
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, cy - r + 1)
    ctx.lineTo(0, cy + r - 1)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.ellipse(-3.2, cy - 4.6, 2.6, 1.5, -0.6, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  // face
  const blink = Math.sin(clock * 0.9) > 0.985 ? 0.25 : 1
  ctx.fillStyle = '#20122a'
  ctx.beginPath()
  ctx.ellipse(-3, cy - 0.4, 1.5, 2.1 * blink, 0, 0, Math.PI * 2)
  ctx.ellipse(3, cy - 0.4, 1.5, 2.1 * blink, 0, 0, Math.PI * 2)
  ctx.fill()
  // eye glints
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(-2.5, cy - 1.2, 0.5, 0, Math.PI * 2)
  ctx.arc(3.5, cy - 1.2, 0.5, 0, Math.PI * 2)
  ctx.fill()
  // rosy cheeks
  ctx.fillStyle = 'rgba(255,110,170,0.5)'
  ctx.beginPath()
  ctx.arc(-5.4, cy + 2.1, 1.5, 0, Math.PI * 2)
  ctx.arc(5.4, cy + 2.1, 1.5, 0, Math.PI * 2)
  ctx.fill()
  // smile
  ctx.strokeStyle = '#20122a'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(0, cy + 1.1, 2.5, pose === 'interact' ? 0.15 : 0.5, Math.PI - (pose === 'interact' ? 0.15 : 0.5))
  ctx.stroke()

  // helmet highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.beginPath()
  ctx.ellipse(-3.2, cy - 4.6, 2.6, 1.5, -0.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawSleeping(ctx: CanvasRenderingContext2D, skin: Skin, clock: number) {
  ctx.save()
  ctx.translate(-2, -7)
  ctx.rotate(-Math.PI / 2.1)
  drawBody(ctx, skin, 0)
  drawHelmet(ctx, skin, 0, 'sleep', clock)
  ctx.restore()
  // blanket
  ctx.fillStyle = skin.suitDark
  roundRect(ctx, -13, -8, 26, 8, 3)
  ctx.fill()
  // z z z
  ctx.fillStyle = '#28e6ff'
  ctx.font = 'bold 8px monospace'
  const drift = (clock * 12) % 16
  ctx.fillText('z', 6, -14 - drift * 0.5)
  ctx.fillText('z', 11, -20 - drift * 0.7)
}

function drawEmote(ctx: CanvasRenderingContext2D, clock: number) {
  const bounce = Math.sin(clock * 6) * 1.5
  ctx.fillStyle = '#ffd24a'
  ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('!', 0, -46 + bounce)
  ctx.textAlign = 'left'
}

/* tiny helpers ---------------------------------------------------- */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Small standalone portrait, used by the onboarding skin picker.
 */
export function drawCharacterPreview(
  ctx: CanvasRenderingContext2D,
  skinId: string,
  w: number,
  h: number,
  clock: number,
) {
  ctx.clearRect(0, 0, w, h)
  drawCharacter(ctx, {
    x: w / 2,
    y: h - 10,
    facing: Math.PI / 2,
    pose: 'idle',
    anim: clock,
    skin: skinId,
    scale: Math.min(w, h) / 52,
  })
}

/** Small warm/cool ring used when a skin is selected in the picker. */
export function skinGlow(skin: Skin | string): string {
  return skinById(typeof skin === 'string' ? skin : skin.id).accent
}
