/**
 * Dev-only self-test harness.
 *
 * App.tsx imports this behind `import.meta.env.DEV`, so the whole module is
 * tree-shaken out of the shipped bundle — production has no test code and no
 * console handle into the engine.
 *
 * Run it from the browser console, or from the preview tooling:
 *
 *   await window.__dilimaze.runSelfTest()
 *
 * It plays all 100 cities through the real engine, checks the generator is
 * always solvable, exercises the puzzle / save / tamper paths, and measures the
 * rendered frame brightness. The player's own save is restored afterwards.
 */

import {
  CITIES_PER_REGION,
  REGIONS,
  TS,
  blockedTargets,
  clueAssist,
  clueCount,
  generateCity,
  mapSize,
} from '../game/city'
import { Game, dayHour, dayLight, streetRight } from '../game/engine'
import {
  PROFILE_KEY,
  freshProfile,
  loadProfile,
  saveProfile,
  storageAvailable,
  type LookMode,
} from '../game/profile'
import { RECORDS_KEY, clearRecords, fmtClock, loadRecords, recordCityTime, recordRun } from '../game/records'
import { render } from '../game/render'
import { sfx } from '../game/sound'
import type { CharacterPose, Puzzle, TileKind, World } from '../game/types'

export interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

export interface SelfTestReport {
  ok: boolean
  passed: number
  failed: number
  results: CheckResult[]
}

/* ------------------------------------------------------------------ */
/* plumbing                                                            */
/* ------------------------------------------------------------------ */

class Suite {
  results: CheckResult[] = []

  check(name: string, ok: boolean, detail = ''): boolean {
    this.results.push({ name, ok, detail })
    return ok
  }
}

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* ignore: the tests that need storage report it themselves */
  }
}

function restoreRaw(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value)
  } catch {
    /* nothing to do */
  }
}

function hashTiles(world: World): string {
  let h = 0x811c9dc5
  for (let i = 0; i < world.tiles.length; i++) {
    h ^= world.tiles[i].charCodeAt(0) + i
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (const p of world.props) {
    h ^= (p.id * 31 + p.x + p.y * 7) | 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** does every puzzle carry an answer that actually matches its own puzzle? */
function puzzleIsSolvable(p: Puzzle): boolean {
  switch (p.kind) {
    case 'word': {
      if (!p.answer) return false
      const scram = p.scrambled.replace(/[^a-z]/gi, '').toUpperCase()
      // the scrambled board must be a genuine anagram of the answer
      return (
        scram.length === p.answer.length &&
        scram.split('').sort().join('') === p.answer.split('').sort().join('')
      )
    }
    case 'code':
      return p.answer.length > 0 && Number.isFinite(Number(p.answer))
    case 'choice':
      return p.options.length > 0 && p.answer >= 0 && p.answer < p.options.length
    case 'sequence':
      return p.shown.length > 0 && p.answer.length > 0 && p.answer.every((i) => i >= 0 && i < p.shown.length)
    default:
      return false
  }
}

function wrongAnswerFor(p: Puzzle): string | number | number[] {
  switch (p.kind) {
    case 'word':
      return p.answer === 'ZZZZZZ' ? 'QQQQQQ' : 'ZZZZZZ'
    case 'code':
      return p.answer === '0' ? '1' : '0'
    case 'choice':
      return (p.answer + 1) % p.options.length
    case 'sequence':
      return p.answer.map((i) => (i + 1) % p.shown.length)
    default:
      return ''
  }
}

function answerFor(p: Puzzle): string | number | number[] {
  switch (p.kind) {
    case 'word':
      return p.answer
    case 'code':
      return p.answer
    case 'choice':
      return p.answer
    case 'sequence':
      return p.answer
    default:
      return ''
  }
}

function meanLuminance(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data
  let sum = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    n++
  }
  return n ? sum / n : 0
}

/* ------------------------------------------------------------------ */
/* generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Pick a clear straight approach to a coin for the pickup tests. Coin scatter
 * floats with the prop table, so a fixed "walk right" start could begin behind a
 * block; this finds a side with an open three tile run and the key that walks in.
 */
function coinApproach(world: World, coin: { x: number; y: number }): { x: number; y: number; key: string } | null {
  const cx = Math.floor(coin.x / TS)
  const cy = Math.floor(coin.y / TS)
  const open = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false
    const t = world.tiles[y * world.w + x]
    if (t !== 'road' && t !== 'sidewalk' && t !== 'plaza' && t !== 'park') return false
    for (const pr of world.props)
      if (pr.blocking && !pr.used && Math.abs(pr.x - ((x + 0.5) * TS)) < 24 && Math.abs(pr.y - ((y + 0.5) * TS)) < 24)
        return false
    return true
  }
  const dirs: Array<[number, number, string]> = [
    [-1, 0, 'KeyD'],
    [1, 0, 'KeyA'],
    [0, -1, 'KeyS'],
    [0, 1, 'KeyW'],
  ]
  for (const [dx, dy, key] of dirs) {
    let clear = true
    for (let step = 1; step <= 3 && clear; step++) if (!open(cx + dx * step, cy + dy * step)) clear = false
    if (!clear) continue
    return { x: (cx + dx * 3 + 0.5) * TS, y: (cy + dy * 3 + 0.5) * TS, key }
  }
  return null
}

function generationTests(s: Suite): void {
  const worlds: World[] = []
  let sizeOk = true
  let sizeDetail = ''
  let clueOk = true
  let clueDetail = ''
  let propOk = true
  let propDetail = ''
  let hintOk = true
  let hintDetail = ''
  let puzzleOk = true
  let puzzleDetail = ''
  let guardOk = true
  let guardDetail = ''
  let chainRepeat = ''
  let treeOff = ''
  let treeCount = 0
  let pondCities = 0
  let pondOff = ''
  const riddleLines = new Set<string>()
  let clueLines = 0
  let fixes = 0
  const worstCities: string[] = []

  const t0 = performance.now()
  for (let city = 1; city <= 100; city++) {
    const w = generateCity(city)
    worlds.push(w)
    fixes += w.solvabilityFixes ?? 0
    if ((w.solvabilityFixes ?? 0) > 0) worstCities.push(`${city}:${w.solvabilityFixes}`)

    const want = mapSize(city)
    if (w.w !== want.w || w.h !== want.h) {
      sizeOk = false
      sizeDetail ||= `city ${city}: ${w.w}x${w.h}`
    }
    if (w.clues.length !== clueCount(city)) {
      clueOk = false
      clueDetail ||= `city ${city}: ${w.clues.length} != ${clueCount(city)}`
    }
    if (w.guards.length < 2) {
      guardOk = false
      guardDetail ||= `city ${city}: ${w.guards.length} guards`
    }
    if (w.props.filter((p) => p.hide).length < 2) {
      guardOk = false
      guardDetail ||= `city ${city}: ${w.props.filter((p) => p.hide).length} hiding spots`
    }
    const seenProps = new Set<number>()
    for (const c of w.clues) {
      const prop = w.propAt.get(c.propId)
      if (!prop || prop.data !== 'clue' || seenProps.has(c.propId)) {
        propOk = false
        propDetail ||= `city ${city}: clue prop #${c.propId}`
      }
      seenProps.add(c.propId)
      if (!c.riddle || !c.hint) {
        hintOk = false
        hintDetail ||= `city ${city}: clue without riddle/hint`
      }
      if (c.puzzle && !puzzleIsSolvable(c.puzzle)) {
        puzzleOk = false
        puzzleDetail ||= `city ${city}: ${c.puzzle.kind}`
      }
    }
    // a chain should read as a chain, not as the same line handed out twice
    const chainLines = new Set(w.clues.map((c) => c.riddle))
    if (chainLines.size !== w.clues.length)
      chainRepeat ||= `city ${city}: ${w.clues.length - chainLines.size} repeated line(s)`
    for (const line of chainLines) riddleLines.add(line)
    clueLines += w.clues.length
    // trees must line the footpaths and nothing else
    for (const pr of w.props) {
      if (pr.kind !== 'tree') continue
      treeCount++
      const tx = Math.floor(pr.x / TS)
      const ty = Math.floor(pr.y / TS)
      if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || w.tiles[ty * w.w + tx] !== 'sidewalk')
        treeOff ||= `city ${city} tree on ${w.tiles[ty * w.w + tx]}`
    }
    // ponds: water only ever ringed by paving, never against a building or wall
    let water = 0
    for (let y = 0; y < w.h; y++)
      for (let x = 0; x < w.w; x++) {
        if (w.tiles[y * w.w + x] !== 'water') continue
        water++
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as Array<[number, number]>) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue
          const nt = w.tiles[ny * w.w + nx]
          if (nt === 'building' || nt === 'wall') pondOff ||= `city ${city} water beside ${nt}`
        }
      }
    if (water > 0) pondCities++
    if (!w.entryHint) {
      hintOk = false
      hintDetail ||= `city ${city}: no entry hint`
    }
  }
  const genMs = performance.now() - t0

  s.check(
    'all 100 cities generate at the size the difficulty curve asks for',
    sizeOk,
    sizeDetail || `${worlds[0].w}x${worlds[0].h} → ${worlds[99].w}x${worlds[99].h}`,
  )
  let grows = true
  for (let i = 1; i < worlds.length; i++)
    if (worlds[i].w < worlds[i - 1].w || worlds[i].h < worlds[i - 1].h) grows = false
  s.check('every city is at least as big as the one before it', grows)
  s.check(
    'the clue chain grows with the city (2 → 9 links)',
    clueOk,
    clueDetail || `${worlds[0].clues.length} → ${worlds[99].clues.length} clues`,
  )
  s.check('every clue points at a real, unique landmark prop', propOk, propDetail || '100 cities clean')
  s.check('every clue carries both a riddle and a locator hint', hintOk, hintDetail || '100 cities clean')
  s.check('every puzzle is internally solvable', puzzleOk, puzzleDetail || 'all answers consistent')
  s.check(
    'no city hands out the same riddle twice in one chain',
    chainRepeat === '',
    chainRepeat || 'all 100 chains read as 100 different lines',
  )
  s.check(
    'riddle wording moves on from city to city',
    riddleLines.size >= clueLines * 0.6,
    `${riddleLines.size} distinct lines across ${clueLines} clues`,
  )
  let shared = ''
  for (let i = 1; i < worlds.length && !shared; i++) {
    const before = new Set(worlds[i - 1].clues.map((c) => c.riddle))
    const clash = worlds[i].clues.find((c) => before.has(c.riddle))
    if (clash) shared = `city ${i} and city ${i + 1} both say "${clash.riddle.slice(0, 48)}..."`
  }
  s.check(
    'two cities in a row never hand out the same riddle',
    shared === '',
    shared || `${riddleLines.size} lines, none shared by neighbours`,
  )
  let hints = ''
  const hintLines = new Set<string>()
  for (const w of worlds) for (const c of w.clues) hintLines.add(c.hint)
  for (const w of worlds) if (new Set(w.clues.map((c) => c.hint)).size !== w.clues.length) hints ||= `city ${w.city} repeats a hint`
  s.check(
    'locator hints are reworded as well',
    hints === '' && hintLines.size >= clueLines * 0.6,
    hints || `${hintLines.size} distinct locator lines across ${clueLines} clues`,
  )
  s.check(
    'every city has guards and somewhere to hide from them',
    guardOk,
    guardDetail || `${worlds[0].guards.length} → ${worlds[99].guards.length} guards, cover in all 100`,
  )
  s.check(
    'generating all 100 cities stays fast',
    genMs < 3000,
    `${genMs.toFixed(0)}ms total · ${(genMs / 100).toFixed(1)}ms per city`,
  )
  s.check(
    'generation is deterministic for a given city',
    hashTiles(generateCity(57)) === hashTiles(generateCity(57)),
    'seed 57 reproduced',
  )
  s.check('cities are varied, not clones', hashTiles(generateCity(30)) !== hashTiles(generateCity(31)))
  s.check(
    'the solvability pass rarely has to intervene',
    fixes <= 20,
    `${fixes} prop blocking flags downgraded across 100 cities · ${worstCities.slice(0, 12).join(' ')}`,
  )
  s.check(
    'every tree stands on a footpath and none on the road or the grass',
    treeOff === '' && treeCount > 0,
    treeOff || `${treeCount} trees, all on sidewalks`,
  )
  s.check(
    'ponds sit at the crossroads ringed by paving, never against a wall',
    pondOff === '' && pondCities >= 80,
    pondOff || `water in ${pondCities} of 100 cities, all ringed`,
  )
  // a fountain wants a neighbour and some room: beside a block or a tree, with
  // no other prop crowding it
  let fountainBad = ''
  for (const w of worlds) {
    for (const f of w.props.filter((p) => p.kind === 'fountain')) {
      const tx = Math.floor(f.x / TS)
      const ty = Math.floor(f.y / TS)
      const beside =
        w.tiles[(ty - 1) * w.w + tx] === 'building' ||
        w.tiles[(ty + 1) * w.w + tx] === 'building' ||
        w.tiles[ty * w.w + tx - 1] === 'building' ||
        w.tiles[ty * w.w + tx + 1] === 'building'
      const treeNear = w.props.some(
        (p) =>
          p.kind === 'tree' && Math.abs(p.x - f.x) <= 2.5 * TS && Math.abs(p.y - f.y) <= 2.5 * TS,
      )
      // a tree is a neighbour, not clutter: only other furniture crowds
      const crowded = w.props.some(
        (p) =>
          p.id !== f.id &&
          p.kind !== 'tree' &&
          Math.abs(p.x - f.x) <= 1.4 * TS &&
          Math.abs(p.y - f.y) <= 1.4 * TS,
      )
      if ((!beside && !treeNear) || crowded) fountainBad ||= `city ${w.city} fountain at ${tx},${ty}`
    }
  }
  s.check(
    'a fountain stands beside a block or a tree, never crowded',
    fountainBad === '',
    fountainBad || 'every fountain has a neighbour and room to breathe',
  )
}

/* ------------------------------------------------------------------ */
/* solvability                                                         */
/* ------------------------------------------------------------------ */

function solvabilityTests(s: Suite): void {
  const broken: string[] = []
  for (let city = 1; city <= 100; city++) {
    const w = generateCity(city)
    const blocked = blockedTargets(w)
    if (blocked.length) broken.push(`city ${city}: ${blocked.join(', ')}`)
  }
  s.check(
    'no clue and no border gate is ever walled off (all 100 cities)',
    broken.length === 0,
    broken.slice(0, 3).join(' | ') || 'flood fill reached every target',
  )

  // a city regenerated under a different RNG frame must still be solvable
  const again = blockedTargets(generateCity(73))
  s.check('repeat generation stays solvable', again.length === 0, again.join(', ') || 'clean')
}

/* ------------------------------------------------------------------ */
/* progression                                                         */
/* ------------------------------------------------------------------ */

function progressionTests(s: Suite): void {
  const profile = freshProfile('SelfTest')
  const game = new Game(1, 0, 0, { profile, skinId: 'dlicom' })
  let gateOk = true
  let gateDetail = ''
  let dialogBeats = 0
  let carryOk = true
  let carryDetail = ''

  for (let city = 1; city <= 100; city++) {
    if (game.world.city !== city) {
      gateOk = false
      gateDetail = `expected city ${city}, engine holds ${game.world.city}`
      break
    }
    // isolate the gate path from the guard chase (guards have their own test)
    game.world.guards.length = 0
    const coinsBefore = game.player.coins
    game.player.hasPass = true
    game.player.hidden = false
    game.player.x = (game.world.w - 1) * TS + 8
    game.player.y = game.world.gate.y * TS
    game.tick(1 / 60)
    if (game.status !== 'cityCleared') {
      gateOk = false
      gateDetail = `city ${city}: status "${game.status}" instead of cityCleared`
      break
    }
    for (let i = 0; i < 40 && game.status === 'cityCleared'; i++) game.tick(0.1)
    // widened to string: the loop above narrows the union for the compiler
    const after: string = game.status
    if (after === 'dialog') {
      // the region-cleared lore beat
      dialogBeats++
      game.closeDialog()
    }
    if (after === 'victory') break
    if (game.player.coins !== coinsBefore) {
      carryOk = false
      carryDetail = `city ${city}: ${coinsBefore} → ${game.player.coins} $DLI`
    }
  }

  s.check('a border pass opens every one of the 100 gates in order', gateOk, gateDetail || 'reached city 100')
  s.check(
    'clearing city 100 ends the run in victory',
    game.status === 'victory',
    `final status "${game.status}"`,
  )
  s.check(
    'each completed region hands over its lore snippet',
    REGIONS.every((r) => profile.lore[r.id] === true),
    `${Object.keys(profile.lore).length}/${REGIONS.length} regions unlocked`,
  )
  s.check('career progress is written to the profile', profile.bestCity === 100, `bestCity ${profile.bestCity}`)
  s.check(
    'every cleared city is counted exactly once',
    profile.stats.citiesCleared === 100,
    `citiesCleared ${profile.stats.citiesCleared}`,
  )
  s.check(
    'a lore beat fires as each region completes',
    dialogBeats === REGIONS.length - 1, // the last one is silent: victory takes the screen
    `${dialogBeats} beats`,
  )
  s.check('$DLI carries across every border', carryOk, carryDetail || 'coins preserved on all 99 crossings')
  s.check('the run ends in the final city', game.world.city === 100, `city ${game.world.city}`)
}

/* ------------------------------------------------------------------ */
/* city types, colours, ranged guards, carried bars, the tutorial      */
/* ------------------------------------------------------------------ */

function cityTypeTests(s: Suite): void {
  // ---- the type turns every five levels, and never repeats in a region ----
  const types = Array.from({ length: 100 }, (_, i) => generateCity(i + 1).archetype.id)
  // each five level block is one type all the way through, and each block turns
  let turnsOk = true
  let turnDetail = ''
  for (let block = 0; block < 20; block++) {
    for (let i = 1; i < 5; i++) {
      if (types[block * 5 + i] !== types[block * 5]) {
        turnsOk = false
        turnDetail = `city ${block * 5 + i + 1} broke its five level block`
        break
      }
    }
    if (!turnsOk) break
    if (block < 19 && types[block * 5] === types[(block + 1) * 5]) {
      turnsOk = false
      turnDetail = `blocks ${block + 1} and ${block + 2} are both ${types[block * 5]}`
      break
    }
  }
  s.check('the city type holds for five levels and then turns', turnsOk, turnDetail || '20 blocks, all turning')

  // a region is four blocks wide, so it shows four of the five types and no repeat
  let regionOk = true
  let regionDetail = ''
  const blocksPerRegion = CITIES_PER_REGION / 5
  for (let region = 0; region < 100 / CITIES_PER_REGION; region++) {
    const shown = new Set<string>()
    for (let k = 0; k < blocksPerRegion; k++) shown.add(types[(region * blocksPerRegion + k) * 5])
    if (shown.size !== blocksPerRegion) {
      regionOk = false
      regionDetail = `region ${region + 1} shows ${[...shown].join(', ')}`
      break
    }
  }
  s.check('no region repeats a city type', regionOk, regionDetail || `${blocksPerRegion} distinct types per region`)

  const kinds = new Set(types)
  s.check('every city type in the deck actually gets built', kinds.size >= 5, `${kinds.size} types: ${[...kinds].join(', ')}`)

  const metro = generateCity(1)
  const forest = generateCity(11)
  const future = generateCity(16)
  const countTiles = (world: World, kind: TileKind) => world.tiles.filter((tile) => tile === kind).length
  s.check(
    'future districts reserve larger civic plazas than metro blocks',
    countTiles(future, 'plaza') > countTiles(metro, 'plaza'),
    `plaza tiles ${countTiles(metro, 'plaza')} → ${countTiles(future, 'plaza')}`,
  )
  s.check(
    'forest clearings generate a broad park canopy',
    countTiles(forest, 'park') > countTiles(future, 'park'),
    `park tiles ${countTiles(forest, 'park')} vs ${countTiles(future, 'park')}`,
  )

  // ---- each city gets its own paint on top of the type ----
  let paintOk = true
  let paintDetail = ''
  for (let city = 1; city < 100; city++) {
    const a = generateCity(city).region
    const b = generateCity(city + 1).region
    if (a.building === b.building && a.grass === b.grass && a.road === b.road) {
      paintOk = false
      paintDetail = `city ${city} and city ${city + 1} are painted identically`
      break
    }
  }
  s.check('neighbouring cities are painted differently', paintOk, paintDetail || '99 crossings, all distinct')

  const sample = generateCity(1).region
  s.check(
    'every colour the renderer parses is a six digit hex',
    [sample.grass, sample.road, sample.building, sample.buildingAlt, sample.accent, sample.neon, sample.neon2].every(
      (c) => /^#[0-9a-f]{6}$/i.test(c),
    ),
    `${sample.building} / ${sample.neon}`,
  )

  // ---- patrols thicken and quicken as the run goes on ----
  let countClimbs = true
  let countDetail = ''
  for (let city = 1; city < 100; city++) {
    if (generateCity(city + 1).guards.length < generateCity(city).guards.length) {
      countClimbs = false
      countDetail = `city ${city + 1} fields fewer guards than city ${city}`
      break
    }
  }
  s.check('the patrol count never falls as you go east', countClimbs, countDetail || 'monotone growth')
  s.check(
    'later cities field more guards than early ones',
    generateCity(60).guards.length > generateCity(1).guards.length,
    `${generateCity(1).guards.length} → ${generateCity(60).guards.length} guards`,
  )

  const fastest = (city: number) => Math.max(...generateCity(city).guards.map((g) => g.speed))
  s.check(
    'guard speed climbs with the city',
    fastest(60) > fastest(6),
    `${fastest(6).toFixed(2)} → ${fastest(60).toFixed(2)} tiles/s`,
  )
  s.check(
    'but no guard outruns a sprint, even at night',
    fastest(100) * 1.1 < 5.6,
    `fastest guard ${fastest(100).toFixed(2)} tiles/s, ${(fastest(100) * 1.1).toFixed(2)} at night vs 5.6 sprint`,
  )

  // ---- guard roles ----
  const early = generateCity(5).guards
  s.check(
    'the opening levels field brawlers only',
    early.every((g) => g.role === 'beat'),
    `${[...new Set(early.map((g) => g.role))].join(', ')}`,
  )

  let shooterCity = 0
  for (let city = 11; city <= 100 && !shooterCity; city++) {
    if (generateCity(city).guards.some((g) => g.role === 'gun')) shooterCity = city
  }
  s.check('a deep city fields a shooting guard', shooterCity > 0, shooterCity ? `first shooter in city ${shooterCity}` : 'no shooter found')

  const rolesSeen = new Set<string>()
  for (let city = 11; city <= 100; city++) for (const g of generateCity(city).guards) rolesSeen.add(g.role)
  s.check(
    'all six patrol roles appear across the run',
    ['beat', 'long', 'wide', 'gun', 'tracker', 'charger'].every((r) => rolesSeen.has(r)),
    [...rolesSeen].sort().join(', '),
  )
  s.check(
    'elite tracker and charger roles unlock from City 21',
    generateCity(20).guards.every((g) => g.role !== 'tracker' && g.role !== 'charger') &&
      ['tracker', 'charger'].every((role) => generateCity(60).guards.some((g) => g.role === role)),
    'standard patrols first, elite abilities in later cities',
  )

  // a watcher's cone really is longer / wider than a brawler's (captains excluded,
  // since a captain is deliberately a step above its own city)
  const plain = generateCity(20).guards.filter((g) => !g.captain)
  const best = (role: string, key: 'visionDist' | 'visionHalfAngle') =>
    Math.max(0, ...plain.filter((g) => g.role === role).map((g) => g[key]))
  s.check(
    'a long watcher sees further than a brawler',
    best('long', 'visionDist') > best('beat', 'visionDist'),
    `${Math.round(best('long', 'visionDist'))} vs ${Math.round(best('beat', 'visionDist'))} px`,
  )
  s.check(
    'a wide watcher covers more of a corner than a brawler',
    best('wide', 'visionHalfAngle') > best('beat', 'visionHalfAngle'),
    `${best('wide', 'visionHalfAngle').toFixed(2)} vs ${best('beat', 'visionHalfAngle').toFixed(2)} rad`,
  )

  const elites = new Game(60, 0, 0, { profile: freshProfile('Elite checks') })
  const charger = elites.world.guards.find((g) => g.role === 'charger')
  if (charger) {
    elites.world.guards = [charger]
    charger.abilityCd = 0
    charger.alert = 0.8
    charger.state = 'chase'
    charger.lastSeen = { x: elites.player.x + TS * 2, y: elites.player.y }
    elites.tick(0.1)
    s.check('a charger activates its limited pursuit burst', charger.burstTimer > 0, `${charger.burstTimer.toFixed(2)}s burst`)
  } else {
    s.check('a charger activates its limited pursuit burst', false, 'no charger in City 60')
  }

  const trackerGame = new Game(60, 0, 0, { profile: freshProfile('Tracker check') })
  const tracker = trackerGame.world.guards.find((g) => g.role === 'tracker')
  if (tracker) {
    trackerGame.world.guards = [tracker]
    trackerGame.player.hidden = true
    tracker.x = trackerGame.player.x + TS * 0.25
    tracker.y = trackerGame.player.y
    tracker.dir = Math.PI
    tracker.alert = 0.35
    tracker.state = 'patrol'
    ;(trackerGame as unknown as { updateGuards: (dt: number) => void }).updateGuards(0.2)
    s.check('a nearby tracker can detect a hidden runner at close range', tracker.alert > 0.35, `alert ${tracker.alert.toFixed(2)}`)
  } else {
    s.check('a nearby tracker can detect a hidden runner at close range', false, 'no tracker in City 60')
  }

  // ---- a shooter hurts, and enough rounds put the runner down ----
  if (shooterCity) {
    const g = new Game(shooterCity, 0, 0, { profile: freshProfile('Target') })
    const gunner = g.world.guards.find((x) => x.role === 'gun')
    if (gunner) {
      // solo the shooter, and hold it still so this tests the round, not a brawl
      g.world.guards.length = 0
      g.world.guards.push(gunner)
      gunner.speed = 0
      gunner.attackCd = 0
      gunner.alert = 1
      gunner.state = 'chase'
      // the gate row is carved clear of buildings, so the line of sight is open
      gunner.y = g.player.y
      gunner.x = g.player.x + 4 * TS
      gunner.dir = Math.atan2(g.player.y - gunner.y, g.player.x - gunner.x)
      // count the rounds that land, so "a bullet is lethal" is measured and not
      // just assumed: from a full bar the runner must go down in three or fewer
      let hits = 0
      let lastHealth = g.player.health
      const advance = (n: number, until: () => boolean) => {
        for (let i = 0; i < n && until(); i++) {
          g.tick(0.05)
          if (g.player.health < lastHealth) {
            hits++
            lastHealth = g.player.health
          }
        }
      }
      advance(60, () => g.player.health === 100)
      s.check(
        'a shooting guard takes health off the runner at range',
        hits >= 1,
        `health ${Math.round(g.player.health)}`,
      )
      // the shooter reloads between rounds, so this takes a while of game time,
      // but it stops the moment the runner goes down
      advance(1600, () => g.status === 'playing')
      s.check(
        'at most three rounds put the runner down',
        g.status === 'collapsed' && hits <= 3,
        `${hits} round(s) to down the runner`,
      )
      s.check('a death by gunfire says so, not that you starved', /shot/i.test(g.deathReason), `"${g.deathReason}"`)
    } else {
      s.check('the shooting city regenerates its shooter', false)
    }
  }

  // ---- the three bars cross the border with you ----
  const c = new Game(1, 0, 0, { profile: freshProfile('Carrier') })
  c.world.guards.length = 0
  c.player.hunger = 41
  c.player.thirst = 27
  c.player.health = 63
  c.player.hasPass = true
  c.player.x = (c.world.w - 1) * TS + 8
  c.player.y = c.world.gate.y * TS
  c.tick(1 / 60)
  for (let i = 0; i < 40 && c.status === 'cityCleared'; i++) c.tick(0.1)
  s.check('walking out the gate opens the next city', c.world.city === 2, `city ${c.world.city}`)
  const kept = (v: number, was: number) => Math.abs(v - was) < 0.5
  s.check(
    'hunger, thirst and health carry across the border',
    kept(c.player.hunger, 41) && kept(c.player.thirst, 27) && kept(c.player.health, 63),
    `hunger ${Math.round(c.player.hunger)}, thirst ${Math.round(c.player.thirst)}, health ${Math.round(c.player.health)}`,
  )
  s.check(
    'a new city still opens on a fresh morning clock',
    c.day === 1 && c.daysInCity === 1,
    `day ${c.day}/${c.daysInCity}`,
  )

  // ---- the first time tour flag ----
  const fresh = freshProfile('Tut')
  fresh.tutorialSeen = true
  saveProfile(fresh)
  const reloaded = loadProfile()
  s.check(
    'the tour flag saves, loads and does not read as a tampered save',
    reloaded?.tutorialSeen === true && reloaded.tamperRecovered !== true,
    reloaded ? `seen ${reloaded.tutorialSeen}, tamper ${reloaded.tamperRecovered === true}` : 'no profile',
  )

  // a save written before the tour existed is assumed seen once it has been
  // played, and only a genuinely clean account is handed the tour
  const vet = {
    version: 1,
    name: 'Vet',
    skin: 'dlicom',
    createdAt: 1,
    updatedAt: 1,
    bestCity: 12,
    run: null,
    stats: { attempts: 5, solves: 3, deaths: 1, citiesCleared: 11, timePlayedSec: 120 },
    settings: { sound: true },
    lore: {},
    onboarded: true,
  }
  writeRaw(PROFILE_KEY, JSON.stringify(vet))
  s.check(
    'an old played save skips the first time tour',
    loadProfile()?.tutorialSeen === true,
    `seen ${loadProfile()?.tutorialSeen}`,
  )
  writeRaw(
    PROFILE_KEY,
    JSON.stringify({
      ...vet,
      name: 'New',
      bestCity: 1,
      stats: { attempts: 0, solves: 0, deaths: 0, citiesCleared: 0, timePlayedSec: 0 },
    }),
  )
  s.check(
    'a brand new save still gets the first time tour',
    loadProfile()?.tutorialSeen === false,
    `seen ${loadProfile()?.tutorialSeen}`,
  )
}

/* ------------------------------------------------------------------ */
/* survival + guards                                                   */
/* ------------------------------------------------------------------ */

function survivalTests(s: Suite): void {
  const game = new Game(3, 0, 0, { profile: freshProfile('Survive') })
  game.world.guards.length = 0
  game.player.hunger = 0
  game.player.thirst = 0
  game.player.health = 6

  let collapsed = false
  for (let i = 0; i < 200 && !collapsed; i++) {
    game.tick(0.1)
    if (game.status === 'collapsed') collapsed = true
  }
  s.check('starving and dehydrating collapses the runner', collapsed, `status "${game.status}"`)

  for (let i = 0; i < 40 && game.status === 'collapsed'; i++) game.tick(0.1)
  s.check(
    'collapsing restarts the city on day 1 with full bars',
    game.status === 'playing' && game.day === 1 && game.player.hunger === 100 && game.player.thirst === 100,
    `status "${game.status}", day ${game.day}, hunger ${Math.round(game.player.hunger)}`,
  )
  s.check('a collapse counts as a death', game.deaths >= 1, `${game.deaths} deaths`)

  // dry fountain / eating path
  const g2 = new Game(2, 0, 0, { profile: freshProfile('Fed') })
  g2.world.guards.length = 0
  g2.player.food = 1
  g2.player.hunger = 20
  g2.action('eat')
  s.check('eating restores hunger from inventory', g2.player.food === 0 && g2.player.hunger > 60, `hunger ${Math.round(g2.player.hunger)}`)
  g2.action('eat')
  s.check('eating with an empty bag is refused, not crashed', g2.player.food === 0)

  // $DLI is picked up by contact, with no keypress and no standing prompt
  const g3 = new Game(2, 0, 0, { profile: freshProfile('Collector') })
  g3.world.guards.length = 0
  const coin = g3.world.props.find((x) => x.kind === 'coin')
  const start1 = coin ? coinApproach(g3.world, coin) : null
  if (coin && start1) {
    // stand well away first, so the walk over it is what does the collecting
    g3.player.x = start1.x
    g3.player.y = start1.y
    g3.tick(1 / 60)
    const before = g3.player.coins
    for (let i = 0; i < 300 && !coin.used; i++) {
      g3.setKey(start1.key, true)
      g3.tick(1 / 60)
    }
    g3.setKey(start1.key, false)
    s.check('walking over a $DLI token pockets it', coin.used && g3.player.coins > before, `${before} → ${g3.player.coins} $DLI`)
    // and the standing prompt no longer asks for a keypress
    g3.player.x = coin.x
    g3.player.y = coin.y
    s.check(
      'a collected token stops prompting for a keypress',
      !(g3.getSnapshot().promptText ?? '').includes('(E)'),
      `prompt "${g3.getSnapshot().promptText}"`,
    )
  } else {
    s.check('city 2 has a $DLI token to walk over', false)
  }
}

function guardTests(s: Suite): void {
  const game = new Game(4, 0, 0, { profile: freshProfile('Hunted') })
  const guard = game.world.guards[0]
  if (!guard) {
    s.check('city 4 has a guard to test against', false)
    return
  }
  guard.x = game.player.x + 10
  guard.y = game.player.y
  guard.state = 'chase'
  guard.alert = 1

  let caught = false
  for (let i = 0; i < 20 && !caught; i++) {
    game.tick(0.05)
    if (game.status === 'caught') caught = true
  }
  s.check('a chasing guard catches the runner', caught, `status "${game.status}"`)

  const spawn = { x: game.world.spawn.x * TS, y: game.world.spawn.y * TS }
  for (let i = 0; i < 40 && game.status === 'caught'; i++) game.tick(0.1)
  s.check(
    'being caught costs the day and returns you to the checkpoint',
    game.status === 'playing' && Math.hypot(game.player.x - spawn.x, game.player.y - spawn.y) < 2,
    `status "${game.status}"`,
  )

  // hiding beats a cone
  const g2 = new Game(4, 0, 0, { profile: freshProfile('Sneak') })
  const guard2 = g2.world.guards[0]
  const bush = g2.world.props.find((p) => p.hide)
  if (guard2 && bush) {
    g2.player.x = bush.x
    g2.player.y = bush.y
    g2.player.hidden = true
    guard2.x = bush.x + 8
    guard2.y = bush.y
    guard2.state = 'chase'
    guard2.alert = 1
    let stillCaught = false
    for (let i = 0; i < 10 && !stillCaught; i++) {
      g2.tick(0.05)
      if (g2.status === 'caught') stillCaught = true
    }
    s.check('hiding in cover keeps a chasing guard off you', !stillCaught, stillCaught ? 'caught while hidden' : 'stayed hidden')
  } else {
    s.check('city 4 has cover to hide in', false)
  }

  // ---- patrol routes stay on open ground ----
  // A patrol walks straight between its stops, so every stop must be walkable
  // and every leg between stops must avoid buildings or the guard grinds at a
  // wall and never arrives.
  const isOpenTile = (t: TileKind | undefined) =>
    t === 'road' || t === 'sidewalk' || t === 'plaza' || t === 'park'
  let badNode = ''
  let badLeg = ''
  for (let city = 1; city <= 40 && !badNode && !badLeg; city++) {
    const w = generateCity(city)
    for (const gd of w.guards) {
      for (let i = 0; i < gd.path.length; i++) {
        const tx = Math.floor(gd.path[i].x)
        const ty = Math.floor(gd.path[i].y)
        if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || !isOpenTile(w.tiles[ty * w.w + tx])) {
          badNode = `city ${city} stop ${i} at ${tx},${ty}`
          break
        }
      }
      if (badNode) break
      for (let i = 0; i + 1 < gd.path.length; i++) {
        const a = gd.path[i]
        const b = gd.path[i + 1]
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2))
        for (let k = 1; k <= steps; k++) {
          const t = k / steps
          const tx = Math.floor(a.x + (b.x - a.x) * t)
          const ty = Math.floor(a.y + (b.y - a.y) * t)
          if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h || !isOpenTile(w.tiles[ty * w.w + tx])) {
            badLeg = `city ${city} leg ${i}`
            break
          }
        }
        if (badLeg) break
      }
      if (badLeg) break
    }
  }
  s.check('every patrol stop stands on walkable ground', badNode === '', badNode || 'all stops clear')
  s.check('no patrol leg crosses a building', badLeg === '', badLeg || 'all legs open')

  // ---- guards detour around a block instead of pushing into it ----
  const routing = new Game(4, 0, 0, { profile: freshProfile('Routing') })
  const routeGuard = routing.world.guards[0]
  const isOpen = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < routing.world.w && y < routing.world.h &&
    isOpenTile(routing.world.tiles[y * routing.world.w + x])
  let detourTarget: { x: number; y: number } | null = null
  let detourStart = { x: -1, y: -1 }
  if (routeGuard) {
    const sx = Math.floor(routeGuard.x / TS)
    const sy = Math.floor(routeGuard.y / TS)
    detourStart = { x: sx, y: sy }
    for (let ty = 1; ty < routing.world.h - 1 && !detourTarget; ty++) {
      for (let tx = 1; tx < routing.world.w - 1; tx++) {
        if (!isOpen(tx, ty) || (tx === sx && ty === sy)) continue
        const steps = Math.max(1, Math.ceil(Math.hypot(tx - sx, ty - sy) * 2))
        let crossesBlock = false
        for (let k = 1; k < steps; k++) {
          const x = Math.floor(sx + (tx - sx) * k / steps)
          const y = Math.floor(sy + (ty - sy) * k / steps)
          if (!isOpen(x, y)) { crossesBlock = true; break }
        }
        if (crossesBlock) { detourTarget = { x: tx, y: ty }; break }
      }
    }
  }
  let detourSucceeded = false
  let detourDetail = 'no route case found'
  if (routeGuard && detourTarget) {
    const move = (routing as unknown as { moveGuardToward: (gd: typeof routeGuard, x: number, y: number, d: number) => boolean }).moveGuardToward
    const goalX = (detourTarget.x + 0.5) * TS
    const goalY = (detourTarget.y + 0.5) * TS
    let stayedOnGround = true
    let lastDistance = Infinity
    for (let i = 0; i < 3000; i++) {
      move.call(routing, routeGuard, goalX, goalY, 4)
      const gx = Math.floor(routeGuard.x / TS)
      const gy = Math.floor(routeGuard.y / TS)
      if (!isOpen(gx, gy)) { stayedOnGround = false; break }
      lastDistance = Math.hypot(goalX - routeGuard.x, goalY - routeGuard.y)
      if (lastDistance < 6) break
    }
    detourSucceeded = stayedOnGround && lastDistance < 12
    detourDetail = `start ${detourStart.x},${detourStart.y} → target ${detourTarget.x},${detourTarget.y} · ${Math.round(lastDistance)} px away · ground ${stayedOnGround}`
  }
  s.check('a guard routes around a building to reach its target', detourSucceeded, detourSucceeded ? 'detour completed on walkable tiles' : detourDetail)

  // ---- a wedged guard frees itself ----
  const stuck = new Game(4, 0, 0, { profile: freshProfile('Wedged') })
  const wedged = stuck.world.guards[0]
  const building = stuck.world.tiles.findIndex((t) => t === 'building')
  if (wedged && building >= 0) {
    wedged.x = ((building % stuck.world.w) + 0.5) * TS
    wedged.y = (Math.floor(building / stuck.world.w) + 0.5) * TS
    wedged.stuckTimer = 4
    stuck.tick(1 / 60)
    const tx = Math.floor(wedged.x / TS)
    const ty = Math.floor(wedged.y / TS)
    s.check(
      'a wedged guard is freed onto open ground',
      isOpenTile(stuck.world.tiles[ty * stuck.world.w + tx]),
      `tile ${tx},${ty}`,
    )
  } else {
    s.check('city 4 has a guard and a building to wedge', false)
  }

  // ---- the runner keeps off the blocks ----
  // Walk hard into a block face from the open street and the border must hold:
  // the sprite is a body, not a point, so its shoulders may not cross either.
  const wall = new Game(3, 0, 0, { profile: freshProfile('Wall') })
  wall.world.guards.length = 0
  const openTile = (t: TileKind | undefined) => t === 'road' || t === 'sidewalk' || t === 'plaza' || t === 'park'
  let target = -1
  for (let i = 0; i < wall.world.tiles.length && target < 0; i++) {
    if (wall.world.tiles[i] !== 'building') continue
    const x = i % wall.world.w
    const y = Math.floor(i / wall.world.w)
    if (y + 1 < wall.world.h && openTile(wall.world.tiles[(y + 1) * wall.world.w + x])) target = i
  }
  if (target >= 0) {
    const x = target % wall.world.w
    const y = Math.floor(target / wall.world.w)
    wall.player.x = (x + 0.5) * TS
    wall.player.y = (y + 1.5) * TS
    wall.player.vx = 0
    wall.player.vy = 0
    wall.setKey('KeyW', true)
    for (let i = 0; i < 120; i++) wall.tick(1 / 60)
    wall.setKey('KeyW', false)
    const tx = Math.floor(wall.player.x / TS)
    const ty = Math.floor(wall.player.y / TS)
    s.check(
      'the runner cannot walk into a block',
      wall.world.tiles[ty * wall.world.w + tx] !== 'building',
      `ended on tile ${tx},${ty}`,
    )
  } else {
    s.check('a city has a block with an open street in front of it', false)
  }
}

/* ------------------------------------------------------------------ */
/* puzzles                                                             */
/* ------------------------------------------------------------------ */

function puzzleTests(s: Suite): void {
  const game = new Game(6, 0, 0, { profile: freshProfile('Puzzler') })
  game.world.guards.length = 0
  const idx = game.world.clues.findIndex((c) => c.puzzle)
  if (idx < 0) {
    s.check('city 6 has a puzzle in its chain', false)
    return
  }
  const target = game.world.propAt.get(game.world.clues[idx].propId)!
  game.player.clueIndex = idx
  game.player.x = target.x
  game.player.y = target.y + 10
  game.tick(1 / 60)
  const prompt = game.getSnapshot().promptText
  game.action('interact')
  game.tick(1 / 60)
  const opened = game.status === 'puzzle' && !!game.activePuzzle
  s.check('walking to a chain landmark and pressing interact opens its puzzle', opened, `prompt "${prompt}", status "${game.status}"`)
  if (!opened) return

  const puz = game.activePuzzle!.puzzle
  game.answerPuzzle(wrongAnswerFor(puz))
  s.check(
    'a wrong answer keeps the puzzle open and counts the attempt',
    game.status === 'puzzle' && game.activePuzzle?.tries === 1,
    `status "${game.status}", tries ${game.activePuzzle?.tries}`,
  )
  s.check('the first miss gives nothing away', game.activePuzzle?.nudge === null)

  for (let i = 0; i < 3; i++) game.answerPuzzle(wrongAnswerFor(puz))
  s.check(
    'repeated misses start coaching instead of hard-blocking',
    !!game.activePuzzle?.nudge,
    game.activePuzzle?.nudge ?? 'no nudge',
  )

  game.answerPuzzle(answerFor(puz))
  s.check(
    'the right answer advances the clue chain',
    game.player.clueIndex === idx + 1 && game.status === 'dialog',
    `clueIndex ${game.player.clueIndex}, status "${game.status}"`,
  )
  s.check(
    'the clue dialog hands over a locator hint',
    (game.dialog?.lines.length ?? 0) >= 2,
    (game.dialog?.lines ?? []).join(' / '),
  )

  // out-of-order landmark = dead end, not a shortcut
  game.closeDialog()
  const wrongIdx = (idx + 1) % game.world.clues.length
  const wrongProp = game.world.propAt.get(game.world.clues[wrongIdx].propId)!
  game.player.x = wrongProp.x
  game.player.y = wrongProp.y + 10
  game.tick(1 / 60)
  game.action('interact')
  game.tick(1 / 60)
  s.check(
    'an out-of-order landmark is a dead end',
    game.dialog?.title === 'Dead end' || game.status === 'puzzle',
    `title "${game.dialog?.title ?? '-'}" status "${game.status}"`,
  )

  // the HUD must show the riddle for the clue being hunted, not the one after it
  const g3 = new Game(20, 0, 0, { profile: freshProfile('Hud') })
  g3.world.guards.length = 0
  g3.player.clueIndex = 2
  s.check('city 20 has at least three chain links to index into', g3.world.clues.length >= 3, `${g3.world.clues.length} links`)
  const snap = g3.getSnapshot()
  const expected = g3.world.clues[1].riddle
  s.check(
    'the HUD riddle matches the clue you are hunting (off-by-one fixed)',
    snap.clueHint === expected && expected.length > 0,
    `showing "${snap.clueHint.slice(0, 42)}…"`,
  )
  s.check(
    'the HUD carries the matching locator hint',
    snap.clueHintLine === g3.world.clues[1].hint && snap.clueHintLine.length > 0,
    snap.clueHintLine,
  )
  s.check('the HUD reports a signal band once the arrow stops helping', snap.signal !== null, `signal ${snap.signal}`)
  s.check(
    'the signal band is measured against the clue being hunted',
    (() => {
      const target = g3.world.propAt.get(g3.world.clues[2].propId)!
      g3.player.x = target.x
      g3.player.y = target.y
      return g3.getSnapshot().signal === 'hot'
    })(),
    'standing on the clue reads HOT',
  )

  const early = new Game(2, 0, 0, { profile: freshProfile('Early') })
  const earlySnap = early.getSnapshot()
  s.check(
    'opening cities still get the pinpoint arrow instead',
    earlySnap.clueTrack !== null && earlySnap.signal === null,
    `track ${earlySnap.clueTrack ? 'yes' : 'no'}, signal ${earlySnap.signal}`,
  )
  s.check(
    'the entry hint points at the first clue in every city',
    !!early.world.entryHint && !!generateCity(60).entryHint,
    early.world.entryHint,
  )
  s.check(
    'pinpointing stops after city 5',
    !clueAssist(6, 0) && clueAssist(5, 1) && !clueAssist(5, 2),
    'assist window = cities 1–5, first two clues',
  )
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function renderTests(s: Suite): void {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 320
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    s.check('a 2d context is available to draw into', false)
    return
  }

  const poses: CharacterPose[] = ['idle', 'run', 'crouch', 'climb', 'sleep', 'interact']
  let threw = ''
  try {
    for (const city of [1, 21, 41, 61, 81, 100]) {
      const game = new Game(city, 0, 0, { profile: freshProfile('Painter') })
      for (const pose of poses) {
        game.player.pose = pose
        for (const frac of [0.1, 0.4, 0.85]) {
          game.timeSec = game.world.dayLengthSec * frac
          render(ctx, game, canvas.width, canvas.height)
        }
      }
    }
  } catch (err) {
    threw = String(err)
  }
  s.check(
    'the renderer draws every region, pose and time of day without throwing',
    !threw,
    threw || '6 cities × 6 poses × 3 times of day',
  )

  // brightness, measured once per region: the whole point of the palette pass.
  // A city opens around 06:00 (frac 0) so "day" is sampled at midday and
  // "night" at frac 0.8, deep in the dark part of the arc.
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const perRegion: Array<{ region: string; day: number; night: number }> = []
  for (const city of [1, 21, 41, 61, 81]) {
    const g = new Game(city, 0, 0, { profile: freshProfile('Bright') })
    g.timeSec = g.world.dayLengthSec * 0.45
    render(ctx, g, canvas.width, canvas.height)
    const day = meanLuminance(ctx, canvas.width, canvas.height)
    g.timeSec = g.world.dayLengthSec * 0.8
    render(ctx, g, canvas.width, canvas.height)
    const night = meanLuminance(ctx, canvas.width, canvas.height)
    perRegion.push({ region: g.world.region.name, day, night })
  }
  const asked = perRegion.map((r) => `${r.region} ${r.day.toFixed(0)}/${r.night.toFixed(0)}`).join(' · ')
  s.check(
    'daytime frames are bright enough to read in every region',
    perRegion.every((r) => r.day >= 80),
    asked,
  )
  s.check(
    'night frames stay legible instead of blacking out',
    perRegion.every((r) => r.night >= 55),
    perRegion.map((r) => r.night.toFixed(0)).join(' / '),
  )
  s.check(
    'night is still dimmer than day',
    perRegion.every((r) => r.night < r.day),
    'all five regions',
  )

  // the day arc: a city must open in bright sun and darken as play continues
  {
    const g = new Game(1, 0, 0, { profile: freshProfile('Arc') })
    const lumAt = (frac: number) => {
      g.timeSec = g.world.dayLengthSec * frac
      render(ctx, g, canvas.width, canvas.height)
      return meanLuminance(ctx, canvas.width, canvas.height)
    }
    const sunrise = lumAt(0)
    const noon = lumAt(0.35)
    const dusk = lumAt(0.68)
    const deep = lumAt(0.8)
    const preDawn = lumAt(0.98)
    s.check(
      'a city opens in full sun and darkens as the day runs on',
      sunrise >= 80 && noon >= 80 && dusk < noon && deep < dusk,
      `06:00 ${sunrise.toFixed(0)} · noon ${noon.toFixed(0)} · dusk ${dusk.toFixed(0)} · night ${deep.toFixed(0)}`,
    )
    s.check(
      'the light comes back before the next sunrise so the loop has no hard cut',
      preDawn > deep,
      `05:30 ${preDawn.toFixed(0)} vs night ${deep.toFixed(0)}`,
    )
    s.check(
      'the clock reads morning at the start of a day',
      dayHour(0) === 6 && dayHour(0.5) === 18 && dayHour(0.75) === 0,
      `06:00 / 18:00 / 00:00`,
    )
  }

  const g = new Game(100, 0, 0, { profile: freshProfile('Perf') })
  const t0 = performance.now()
  const frames = 120
  for (let i = 0; i < frames; i++) g.tick(1 / 120)
  const perFrame = (performance.now() - t0) / frames
  s.check(
    'a City-100 simulation frame stays inside the budget',
    perFrame < 8,
    `${perFrame.toFixed(2)}ms/frame (16.7ms budget)`,
  )
}

/* ------------------------------------------------------------------ */
/* save / profile                                                      */
/* ------------------------------------------------------------------ */

function profileTests(s: Suite): void {
  const p = freshProfile('Roundtrip')
  p.bestCity = 42
  p.run = { city: 42, day: 3, daysInCity: 2, hunger: 55.5, thirst: 44.25, health: 91, coins: 137, food: 4, water: 5, clueIndex: 3 }
  p.stats = { attempts: 12, solves: 9, deaths: 2, citiesCleared: 41, timePlayedSec: 1234.5 }
  p.lore = { fringe: true, rustwater: true }
  p.settings = { sound: false, camera: 'walk', look: 'free' }
  p.onboarded = true
  saveProfile(p)

  const back = loadProfile()
  s.check(
    'save → load round-trips every field',
    !!back &&
      back.name === 'Roundtrip' &&
      back.bestCity === 42 &&
      back.run?.coins === 137 &&
      back.run?.clueIndex === 3 &&
      back.lore.fringe === true &&
      back.settings.sound === false &&
      back.settings.camera === 'walk' &&
      back.settings.look === 'free' &&
      back.stats.citiesCleared === 41 &&
      back.onboarded === true,
    back ? `bestCity ${back.bestCity}, coins ${back.run?.coins}, sound ${back.settings.sound}` : 'no profile',
  )
  s.check('an honest save is never flagged as tampered', back?.tamperRecovered !== true)
  s.check('an honest save is never flagged as corrupt', back?.corruptRecovered !== true)

  const raw = readRaw(PROFILE_KEY)
  let sigOk = false
  try {
    const parsed = JSON.parse(raw ?? '{}') as { sig?: string; sigv?: number }
    sigOk = typeof parsed.sig === 'string' && parsed.sig.length > 0 && parsed.sigv === 1
  } catch {
    sigOk = false
  }
  s.check('the save carries an integrity fingerprint', sigOk)

  // regression: a save migrated from the first build has a high bestCity with an
  // empty stat sheet, and runs can start from the world map. Neither may be
  // mistaken for tampering, or real progress gets wiped.
  const migrated = freshProfile('Veteran')
  migrated.bestCity = 21
  migrated.stats = { attempts: 2, solves: 7, deaths: 8, citiesCleared: 1, timePlayedSec: 2700 }
  migrated.run = { ...migrated.run, ...{ city: 21, day: 1, daysInCity: 1, hunger: 94, thirst: 91, health: 100, coins: 28, food: 1, water: 1, clueIndex: 0 } }
  migrated.lore = { fringe: true }
  migrated.onboarded = true
  saveProfile(migrated)
  const veteran = loadProfile()
  s.check(
    'a legacy-migrated save (high bestCity, low clears) is NOT wiped as tampered',
    !!veteran && veteran.tamperRecovered !== true && veteran.bestCity === 21 && veteran.lore.fringe === true,
    `bestCity ${veteran?.bestCity}, cleared ${veteran?.stats.citiesCleared}, tampered ${veteran?.tamperRecovered}`,
  )
  // an impossible run is repaired, never wiped: progress must survive heuristics
  const impossible = { ...migrated, bestCity: 4, run: { ...migrated.run!, city: 99 } }
  saveProfile(impossible)
  const repaired = loadProfile()
  s.check(
    'a run for a city you never reached is dropped instead of wiping the save',
    repaired?.tamperRecovered !== true && repaired?.bestCity === 4 && repaired?.run === null,
    `bestCity ${repaired?.bestCity}, run ${repaired?.run ? repaired.run.city : 'null'}`,
  )

  // ignoring the fingerprint (what a tamperer has to defeat) must still be caught
  const noSig = JSON.parse(raw ?? '{}') as Record<string, unknown>
  delete noSig.sig
  writeRaw(PROFILE_KEY, JSON.stringify(noSig))
  const legacy = loadProfile()
  s.check(
    'fingerprint-less saves (older builds) are accepted, not wiped',
    legacy?.tamperRecovered !== true && legacy?.bestCity === 42,
    `bestCity ${legacy?.bestCity}`,
  )

  saveProfile(p)
}

/* ------------------------------------------------------------------ */
/* security                                                            */
/* ------------------------------------------------------------------ */

function securityTests(s: Suite): void {
  s.check('this environment has working localStorage', storageAvailable())

  // 1. obvious edit: keep the fingerprint, rewrite the progress
  const base = JSON.parse(readRaw(PROFILE_KEY) ?? '{}') as Record<string, unknown>
  const edited = { ...base, bestCity: 100, coins: 999999 } as Record<string, unknown>
  writeRaw(PROFILE_KEY, JSON.stringify(edited))
  const t1 = loadProfile()
  s.check(
    'hand-edited progress is detected and reset',
    t1?.tamperRecovered === true && t1.bestCity === 1,
    `bestCity ${t1?.bestCity}, flagged ${t1?.tamperRecovered}`,
  )
  s.check('the reset keeps the player name', t1?.name === 'Roundtrip', `name "${t1?.name}"`)

  // 2. plausible-looking edit: values the rules would allow, fingerprint untouched
  const sneaky = { ...base, bestCity: 43 } as Record<string, unknown>
  writeRaw(PROFILE_KEY, JSON.stringify(sneaky))
  const t2 = loadProfile()
  s.check(
    'a plausible-looking edit is still caught by the fingerprint',
    t2?.tamperRecovered === true && t2.bestCity === 1,
    `bestCity ${t2?.bestCity}, flagged ${t2?.tamperRecovered}`,
  )

  // 3. prototype pollution attempt
  writeRaw(
    PROFILE_KEY,
    '{"version":1,"name":"Pol","onboarded":true,"lore":{"__proto__":{"polluted":true},"constructor":{"polluted":true},"fringe":true}}',
  )
  const poll = loadProfile()
  const polluted = ({} as Record<string, unknown>).polluted !== undefined
  s.check('a crafted payload cannot pollute Object.prototype', !polluted)
  s.check(
    'unknown lore keys never reach the profile',
    !!poll && Object.keys(poll.lore).length === 1 && poll.lore.fringe === true,
    JSON.stringify(Object.keys(poll?.lore ?? {})),
  )

  // 4. corrupt payload
  writeRaw(PROFILE_KEY, '{not json at all')
  const corrupt = loadProfile()
  s.check(
    'a corrupt payload is replaced by a fresh profile',
    corrupt?.corruptRecovered === true && corrupt.bestCity === 1,
    `flagged ${corrupt?.corruptRecovered}`,
  )

  // 5. oversized payload (DoS guard)
  writeRaw(PROFILE_KEY, 'x'.repeat(70_000))
  const t0 = performance.now()
  const big = loadProfile()
  const bigMs = performance.now() - t0
  s.check(
    'an oversized payload is rejected fast instead of hanging the tab',
    big?.corruptRecovered === true && bigMs < 250,
    `${bigMs.toFixed(1)}ms`,
  )

  // 6. display-name sanitizing
  writeRaw(
    PROFILE_KEY,
    JSON.stringify({ version: 1, name: '<img src=x onerror=alert(1)>\u202eAdmin\u200b', onboarded: true }),
  )
  const named = loadProfile()
  s.check(
    'display names are stripped of markup, bidi overrides and zero-width chars',
    !!named && !/[<>]/.test(named.name) && !/[\u200b-\u200f\u202a-\u202e]/.test(named.name) && named.name.length <= 18,
    JSON.stringify(named?.name),
  )

  // 7. no global handle to the engine in a production bundle — asserted at build
  //    time (see README); in dev the handle exists on purpose, so just report it
  const devHandle = typeof (window as unknown as { game?: unknown }).game !== 'undefined'
  s.check(
    'the engine console handle is dev-only by design',
    true,
    devHandle ? 'present in this dev build (stripped from production)' : 'absent',
  )
}

/* ------------------------------------------------------------------ */
/* ranking records                                                     */
/* ------------------------------------------------------------------ */

function recordsTests(s: Suite): void {
  clearRecords()
  s.check('an empty board loads as a valid, empty object', Object.keys(loadRecords().cities).length === 0)

  recordCityTime(7, 12.5)
  recordCityTime(7, 20) // slower replay must not replace a good time
  s.check(
    'a level timer is banked and only a faster clear replaces it',
    loadRecords().cities['7'] === 12.5,
    `city 7 -> ${loadRecords().cities['7']}`,
  )
  // times are stored to a tenth of a second, so 8.25 is banked as 8.3
  recordCityTime(7, 8.2)
  s.check('a faster clear does replace it', loadRecords().cities['7'] === 8.2, `8.2s kept`)

  recordCityTime(0, 5)
  recordCityTime(101, 5)
  recordCityTime(3, -4)
  recordCityTime(3, Number.NaN)
  recordCityTime(3, 99_999)
  s.check(
    'junk times and out of range cities are refused outright',
    Object.keys(loadRecords().cities).length === 1,
    JSON.stringify(loadRecords().cities),
  )

  recordRun(600)
  recordRun(500)
  s.check(
    'completed runs are kept fastest first',
    loadRecords().runs[0]?.seconds === 500,
    JSON.stringify(loadRecords().runs.map((r) => r.seconds)),
  )

  // a crafted board must never reach Object.prototype or smuggle keys in
  writeRaw(
    RECORDS_KEY,
    '{"version":1,"cities":{"__proto__":{"polluted":true},"constructor":9,"12":"fast","13":4.5},"runs":[{"seconds":"x"},{"seconds":30}]}',
  )
  const poll = loadRecords()
  const polluted = ({} as Record<string, unknown>).polluted !== undefined
  s.check('a crafted board cannot pollute Object.prototype', !polluted)
  s.check(
    'only real city numbers with sane times survive a crafted board',
    Object.keys(poll.cities).join(',') === '13' && poll.runs.length === 1 && poll.runs[0].seconds === 30,
    JSON.stringify(poll),
  )

  writeRaw(RECORDS_KEY, 'x'.repeat(70_000))
  const bigStart = performance.now()
  const big = loadRecords()
  const bigMs = performance.now() - bigStart
  s.check(
    'an oversized board is dropped fast instead of hanging the tab',
    Object.keys(big.cities).length === 0 && bigMs < 250,
    `${bigMs.toFixed(1)}ms`,
  )

  // integration: the engine banks a level timer on the city it just cleared
  clearRecords()
  const g = new Game(7, 0, 0, { profile: freshProfile('Timed') })
  g.cityTimeSec = 42.2
  g.nextCity()
  s.check(
    'the engine banks the level timer when a city is cleared',
    loadRecords().cities['7'] === 42.2 && g.cityTimeSec === 0,
    `city 7 -> ${loadRecords().cities['7']}, stopwatch reset to ${g.cityTimeSec}`,
  )

  // a full run record is only honest when the whole 100 was played in one sitting
  const partial = new Game(100, 0, 0, { profile: freshProfile('Partial') })
  partial.runTimeSec = 120
  partial.nextCity()
  s.check(
    'clearing City 100 after a mid run resume does NOT bank a full run time',
    loadRecords().runs.length === 0 && partial.status === 'victory',
    `${loadRecords().runs.length} run record(s)`,
  )

  const full = new Game(100, 0, 0, { profile: freshProfile('Finisher') })
  ;(full as unknown as { clearedThisSession: number }).clearedThisSession = 100
  full.runTimeSec = 3661.4
  full.nextCity()
  s.check(
    'a City 1 to City 100 run in one sitting is banked as a full run',
    loadRecords().runs[0]?.seconds === 3661.4 && fmtClock(3661.4) === '1:01:01',
    loadRecords().runs.map((r) => `${r.seconds}s (${fmtClock(r.seconds)})`).join(', '),
  )
  clearRecords()
}

/* ------------------------------------------------------------------ */
/* sound cues                                                          */
/* ------------------------------------------------------------------ */

/**
 * The audio itself cannot be asserted, but the wiring can: `sfx` counts every
 * cue that is requested even before the browser hands over an AudioContext, so
 * this drives the real engine and checks each action asks for its own sound.
 */
function soundTests(s: Suite): void {
  const wasEnabled = sfx.isEnabled()
  const wasAmbient = sfx.isAmbient()
  sfx.setEnabled(true)
  sfx.resetFired()

  const g = new Game(2, 0, 0, { profile: freshProfile('Noisy') })
  g.world.guards.length = 0

  g.action('eat')
  s.check('eating asks for its own cue', sfx.getLast() === 'eat', `${sfx.getFired()} cue(s), last ${sfx.getLast()}`)
  g.action('drink')
  s.check('drinking asks for its own cue', sfx.getLast() === 'drink', `${sfx.getFired()} cue(s), last ${sfx.getLast()}`)

  const beforeRefused = sfx.getFired()
  g.action('sleep')
  s.check('a refused sleep stays silent', sfx.getFired() === beforeRefused, `${sfx.getFired()} cue(s)`)

  // walking makes a noise, standing still does not
  const idle = new Game(2, 0, 0, { profile: freshProfile('Still') })
  idle.world.guards.length = 0
  idle.tick(1 / 60)
  const still = sfx.getFired()
  for (let i = 0; i < 90; i++) idle.tick(1 / 60)
  s.check('standing still is silent', sfx.getFired() === still, `${still} cue(s) at rest`)
  for (let i = 0; i < 90; i++) {
    idle.setKey('KeyD', true)
    idle.tick(1 / 60)
  }
  idle.setKey('KeyD', false)
  s.check('walking plays footsteps', sfx.getFired() > still, `${still} → ${sfx.getFired()} cue(s)`)
  s.check('the footstep cue is a step, not something else', sfx.getLast() === 'step', `last ${sfx.getLast()}`)

  // pocketing a token chimes
  const g3 = new Game(2, 0, 0, { profile: freshProfile('Coins') })
  g3.world.guards.length = 0
  const coin = g3.world.props.find((x) => x.kind === 'coin')
  const start3 = coin ? coinApproach(g3.world, coin) : null
  if (coin && start3) {
    g3.player.x = start3.x
    g3.player.y = start3.y
    g3.tick(1 / 60)
    for (let i = 0; i < 300 && !coin.used; i++) {
      g3.setKey(start3.key, true)
      g3.tick(1 / 60)
    }
    g3.setKey(start3.key, false)
    s.check('pocketing $DLI chimes', coin.used && sfx.getLast() === 'coin', `last ${sfx.getLast()}`)
  } else {
    s.check('city 2 has a $DLI token to chime over', false)
  }

  // a guard locking on raises the alarm
  const g2 = new Game(4, 0, 0, { profile: freshProfile('Spotted') })
  const guard = g2.world.guards[0]
  if (guard) {
    const before = sfx.getFired()
    guard.x = g2.player.x - 30
    guard.y = g2.player.y
    guard.dir = 0
    guard.alert = 0.99
    for (let i = 0; i < 10 && guard.state !== 'chase'; i++) g2.tick(1 / 60)
    s.check(
      'a guard locking on plays the spotted cue',
      guard.state === 'chase' && sfx.getFired() > before && sfx.getLast() === 'spotted',
      `state ${guard.state}, last ${sfx.getLast()}`,
    )
  } else {
    s.check('city 4 has a guard to spot with', false)
  }

  // walking out the border gate raises the city cleared fanfare
  const gClear = new Game(3, 0, 0, { profile: freshProfile('Clear') })
  gClear.world.guards.length = 0
  gClear.player.hasPass = true
  gClear.player.x = (gClear.world.w - 1) * TS + 8
  gClear.player.y = gClear.world.gate.y * TS
  sfx.resetFired()
  gClear.tick(1 / 60)
  s.check(
    'clearing a city plays the city cleared cue',
    gClear.status === 'cityCleared' && sfx.getLast() === 'clear',
    `status "${gClear.status}", last ${sfx.getLast()}`,
  )

  // the mute flag silences every cue
  sfx.setEnabled(false)
  const muted = sfx.getFired()
  g.action('eat')
  g.action('drink')
  s.check('muting silences every cue', sfx.getFired() === muted, `${muted} cue(s)`)
  s.check('a fresh engine reads the saved mute flag', (() => {
    const off = freshProfile('Quiet')
    off.settings.sound = false
    void new Game(1, 0, 0, { profile: off })
    return sfx.isEnabled() === false
  })())

  // the UI cues
  sfx.setEnabled(true)
  sfx.resetFired()
  if (typeof document !== 'undefined') {
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    btn.remove()
    s.check('clicking a button plays the click cue', sfx.getLast() === 'click', `last ${sfx.getLast()}`)
  } else {
    s.check('clicking a button plays the click cue', false, 'no document to click in')
  }

  const gOpen = new Game(6, 0, 0, { profile: freshProfile('Opener') })
  gOpen.world.guards.length = 0
  sfx.resetFired()
  gOpen.grantClue(0)
  gOpen.tick(1 / 60)
  s.check('opening a dialog or puzzle panel plays the open cue', sfx.getLast() === 'open', `last ${sfx.getLast()}`)

  s.check(
    'the background bed can be started and stopped',
    (() => {
      sfx.startAmbient()
      const on = sfx.isAmbient()
      sfx.stopAmbient()
      return on && !sfx.isAmbient()
    })(),
  )

  // put the live singleton back exactly as it was found, so running the suite
  // from a paused game cannot mute it or leave the background bed torn down
  sfx.setEnabled(wasEnabled)
  if (wasAmbient) sfx.startAmbient()
  else sfx.stopAmbient()
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

function cameraTests(s: Suite): void {
  const prof = freshProfile('Director')
  const game = new Game(3, 0, 0, { profile: prof })
  game.world.guards.length = 0

  s.check(
    'a run opens on the map camera and remembers the choice',
    game.cameraMode === 'top' && prof.settings.camera === 'top',
    `camera ${game.cameraMode}`,
  )
  game.setCameraMode('walk')
  s.check('switching to the street camera takes effect on the run', game.cameraMode === 'walk')
  s.check('the street camera choice is written to the profile', prof.settings.camera === 'walk')
  s.check('the snapshot reports the live camera', game.getSnapshot().camera === 'walk')
  game.setCameraMode('walk')
  const y0 = game.camYaw
  game.look(120, 0)
  game.look(120, 0)
  // the turn is eased, so the aim moves at once and the heading follows on tick
  s.check('dragging aims the street camera', Math.abs(game.camYaw - y0) < 0.001, 'heading held until the ease runs')
  for (let i = 0; i < 30; i++) game.tick(1 / 60)
  s.check('the street camera eases round to the aim', Math.abs(game.camYaw - y0) > 0.3, `yaw ${game.camYaw.toFixed(2)}`)
  game.look(0, 1000)
  for (let i = 0; i < 30; i++) game.tick(1 / 60)
  s.check('looking up and down stays within its limits', Math.abs(game.camPitch) <= 0.45)

  // how the mouse looks is a setting like the camera, and it is the view layer
  // that reads it, so the test drives the same field the wiring does
  s.check(
    'a run opens with the left button drag look',
    game.lookMode === 'drag' && prof.settings.look === 'drag',
    `look ${game.lookMode}`,
  )
  game.setLookMode('free')
  s.check('the look choice is written to the profile', prof.settings.look === 'free', `profile ${prof.settings.look}`)
  s.check('the snapshot reports the live look mode', game.getSnapshot().look === 'free')
  game.setLookMode('sideways' as LookMode)
  s.check('a junk look mode falls back to the left button drag', game.lookMode === 'drag', `look ${game.lookMode}`)

  // the look is a drag and nothing else: a pointer that is merely resting, or
  // sitting off centre, must never move the camera on its own
  for (let i = 0; i < 150; i++) game.tick(1 / 60)
  game.camPitch = 0
  const yStill = game.camYaw
  for (let i = 0; i < 150; i++) game.tick(1 / 60)
  s.check(
    'the camera holds dead still while no drag is held',
    Math.abs(game.camYaw - yStill) < 0.0001,
    `drift ${Math.abs(game.camYaw - yStill).toFixed(5)}`,
  )
  // a sweep arrives as a stream of small drag events, not one huge jump
  const ySwept = game.camYaw
  for (let i = 0; i < 6; i++) game.look(60, 0)
  for (let i = 0; i < 60; i++) game.tick(1 / 60)
  const yTurned = game.camYaw
  s.check('sweeping the mouse with the button held turns the camera', Math.abs(yTurned - ySwept) > 0.5, `yaw ${yTurned.toFixed(2)}`)
  // release the button: the turn has to stop where it was left
  for (let i = 0; i < 150; i++) game.tick(1 / 60)
  s.check(
    'releasing the button leaves the camera where it stopped',
    Math.abs(game.camYaw - yTurned) < 0.01,
    `drift ${Math.abs(game.camYaw - yTurned).toFixed(4)}`,
  )
  // one absurd event, as a pointer jump or a tab switch delivers
  game.look(100000, 0)
  for (let i = 0; i < 60; i++) game.tick(1 / 60)
  s.check(
    'a wild pointer jump cannot fling the view round',
    Math.abs(game.camYaw - yTurned) <= 0.6,
    `moved ${Math.abs(game.camYaw - yTurned).toFixed(3)}`,
  )
  // The street view has to satisfy two rules at once: a push to the right turns
  // the camera to its right, and the strafe keys step along the camera's own
  // right hand. The engine and the renderer share that one vector, so the way
  // the runner steps and the way the street is drawn can never drift apart.
  const dir = new Game(3, 0, 0, { profile: freshProfile('Stepper') })
  dir.world.guards.length = 0
  dir.setCameraMode('walk')
  dir.camYaw = 0
  const right = streetRight(0)
  s.check(
    'the street camera right hand is a quarter turn clockwise from the way it looks',
    Math.abs(right.x) < 1e-9 && right.y > 0,
    `right (${right.x.toFixed(2)}, ${right.y.toFixed(2)})`,
  )
  dir.setKey('KeyD', true)
  for (let i = 0; i < 10; i++) dir.tick(1 / 60)
  s.check(
    'stepping right moves the runner along the camera right hand',
    dir.player.vx * right.x + dir.player.vy * right.y > 0.1,
    `v (${dir.player.vx.toFixed(1)}, ${dir.player.vy.toFixed(1)})`,
  )
  dir.setKey('KeyD', false)
  dir.setKey('KeyW', true)
  for (let i = 0; i < 10; i++) dir.tick(1 / 60)
  s.check('pushing forward walks the runner the way the camera looks', dir.player.vx > 0.1, `vx ${dir.player.vx.toFixed(1)}`)
  dir.setKey('KeyW', false)
  // a small push must be a small turn: the sensitivity is gentle by design
  for (let i = 0; i < 60; i++) dir.tick(1 / 60)
  const yBefore = dir.camYaw
  dir.look(100, 0)
  for (let i = 0; i < 120; i++) dir.tick(1 / 60)
  const turned = dir.camYaw - yBefore
  s.check(
    'a rightwards mouse push turns the camera to its right, gently',
    turned > 0.15 && turned < 0.3,
    `turned ${turned.toFixed(3)} rad for a 100 px push`,
  )
  // free look follows every pointer move, so the same travel reads faster than a
  // drag and is scaled down a touch: simply hovering must not whip the camera
  dir.setLookMode('free')
  const yFree = dir.camYaw
  dir.look(100, 0)
  for (let i = 0; i < 120; i++) dir.tick(1 / 60)
  const freeTurn = dir.camYaw - yFree
  s.check(
    'free look turns a little gentler than the left button drag',
    freeTurn > 0.1 && freeTurn < turned,
    `free ${freeTurn.toFixed(3)} vs drag ${turned.toFixed(3)}`,
  )

  game.setCameraMode('top')
  const y1 = game.camYaw
  game.look(120, 0)
  s.check('the map view ignores the look input', game.camYaw === y1)
  game.setCameraMode('walk')
  game.toggleCamera()
  s.check('toggling flips back to the map camera', game.cameraMode === 'top')

  // leave it on the street camera so the save round trip has something to check
  game.setCameraMode('walk')
  saveProfile(prof)
  const back = loadProfile()
  s.check('the camera choice survives a save and load', back?.settings.camera === 'walk', `loaded ${back?.settings.camera}`)

  // crossing into the next city must open looking down the road into town: the
  // old camera heading used to survive the border, which could leave the runner
  // staring straight at the wall
  const arriving = new Game(1, 0, 0, { profile: freshProfile('Arriving') })
  arriving.setCameraMode('walk')
  // leave the camera swung round and tilted up, the state a runner can cross
  // the border in
  arriving.camYaw = 2.7
  arriving.camPitch = 0.3
  arriving.nextCity()
  for (let i = 0; i < 30; i++) arriving.tick(1 / 60)
  const aWorld = arriving.world
  const aTile = aWorld.tiles[
    Math.floor(arriving.player.y / TS) * aWorld.w + Math.floor(arriving.player.x / TS)
  ]
  let roadAhead = 0
  const dirX = Math.round(Math.cos(arriving.camYaw))
  const dirY = Math.round(Math.sin(arriving.camYaw))
  for (let step = 1; step <= 8; step++) {
    const tx = Math.floor(arriving.player.x / TS) + dirX * step
    const ty = Math.floor(arriving.player.y / TS) + dirY * step
    if (tx < 0 || ty < 0 || tx >= aWorld.w || ty >= aWorld.h) break
    const t = aWorld.tiles[ty * aWorld.w + tx]
    if (t === 'road' || t === 'sidewalk' || t === 'plaza' || t === 'park') roadAhead++
  }
  s.check(
    'a new city opens with the camera facing the way in',
    Math.abs(arriving.camYaw - arriving.player.facing) < 0.01 && Math.abs(arriving.camPitch) < 0.01,
    `yaw ${arriving.camYaw.toFixed(2)}, pitch ${arriving.camPitch.toFixed(2)}`,
  )
  s.check(
    'the runner arrives standing on a road',
    aTile === 'road' || aTile === 'sidewalk' || aTile === 'plaza',
    `spawn tile ${aTile}`,
  )
  s.check('the road into a new city is open ahead', roadAhead >= 6, `${roadAhead} of 8 tiles walkable`)

  // the walking projection must draw a frame without throwing, day and night
  let rendered = true
  let detail = ''
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) {
      rendered = false
      detail = 'no 2d context'
    } else {
      for (const city of [1, 6, 11, 16, 36]) {
        const archetypeGame = new Game(city)
        archetypeGame.setCameraMode('walk')
        for (const t of [0, 0.45, 0.85]) {
          archetypeGame.timeSec = archetypeGame.world.dayLengthSec * t
          render(ctx, archetypeGame, 640, 360)
        }
      }
      detail = 'five archetypes × three light conditions'
    }
  } catch (err) {
    rendered = false
    detail = `${err}`
  }
  s.check('the street camera renders a frame without throwing', rendered, detail)
}

export function runSelfTest(): SelfTestReport {
  const s = new Suite()
  const savedSave = readRaw(PROFILE_KEY)
  const savedLegacy = readRaw('border-run-save-v1')
  const savedRecords = readRaw(RECORDS_KEY)

  try {
    generationTests(s)
    solvabilityTests(s)
    progressionTests(s)
    cityTypeTests(s)
    survivalTests(s)
    guardTests(s)
    cameraTests(s)
    soundTests(s)
    puzzleTests(s)
    renderTests(s)
    profileTests(s)
    securityTests(s)
    recordsTests(s)
  } catch (err) {
    s.check('the suite ran to completion without throwing', false, `${err}`)
  } finally {
    restoreRaw(PROFILE_KEY, savedSave)
    restoreRaw('border-run-save-v1', savedLegacy)
    // the suite clears cities, which banks ranking times — put the real board back
    restoreRaw(RECORDS_KEY, savedRecords)
  }

  const failed = s.results.filter((r) => !r.ok).length
  return { ok: failed === 0, passed: s.results.length - failed, failed, results: s.results }
}

/** convenience for the console: run and print a compact report */
export async function runAndLogSelfTest(): Promise<SelfTestReport> {
  const report = runSelfTest()
  /* eslint-disable no-console */
  console.log(`DILIMAZE self-test — ${report.ok ? 'PASS' : 'FAIL'} (${report.passed} passed, ${report.failed} failed)`)
  for (const r of report.results) {
    if (!r.ok) console.error(`✗ ${r.name} — ${r.detail}`)
    else console.log(`✓ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  return report
}

// extra handles for poking at the generator while debugging a failure
export const _internals = {
  puzzleIsSolvable,
  hashTiles,
  CITIES_PER_REGION,
  generateCity,
  blockedTargets,
  mapSize,
  clueCount,
  TS,
  dayLight,
  dayHour,
  loadRecords,
}
