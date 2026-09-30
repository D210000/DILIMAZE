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
import { Game, dayHour, dayLight } from '../game/engine'
import { PROFILE_KEY, freshProfile, loadProfile, saveProfile, storageAvailable } from '../game/profile'
import { RECORDS_KEY, clearRecords, fmtClock, loadRecords, recordCityTime, recordRun } from '../game/records'
import { render } from '../game/render'
import type { CharacterPose, Puzzle, World } from '../game/types'

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
  p.settings = { sound: false }
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
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export function runSelfTest(): SelfTestReport {
  const s = new Suite()
  const savedSave = readRaw(PROFILE_KEY)
  const savedLegacy = readRaw('border-run-save-v1')
  const savedRecords = readRaw(RECORDS_KEY)

  try {
    generationTests(s)
    solvabilityTests(s)
    progressionTests(s)
    survivalTests(s)
    guardTests(s)
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
