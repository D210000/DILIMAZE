# DILIMAZE CITIES

_100 cities. One hero. Get out of the country._  
A Dlicom game.

A top-down puzzle-survival game: you guide the **Dlicom mascot** across a country with 100 cities
between you and the border. Clear one city, move to the next — each one harder than the last.
Find clues, solve puzzles, eat, drink, sleep... and stay out of the guard's sight.

**▶ Play now: [DILIMAZE CITIES](https://d210000.github.io/DILIMAZE/)**

## How to play

- Every city hides a **clue chain** — notice boards, bars, radios, graffiti, kids. Follow the
  riddles in order to earn the **border pass**.
- Reach the **east gate** with the pass to move to the next city. No pass, no exit.
- **Every clue comes with a locator hint.** The riddle tells you *which* landmark to look for
  ("Rumor says the stamp hides near the radio"); the gold hint line under it tells you *roughly
  where* ("A fair walk. The radio waits in the northeast of the city"). Before you find the
  first clue, the HUD shows a **first lead** line instead, so no city ever opens with nothing.
- The **clue panel** sits along the bottom of the screen and stays folded to a single bar (clue
  count, signal meter and one line of the riddle) so it never hides the street you are walking.
  It unfolds by itself when a clue lands, folds back a few seconds later, and the chevron pins it
  open or shut as you like.
- **Signal meter** — once the pinpoint help stops (City 6+, third clue on) the HUD shows how warm
  you are: `SIGNAL COLD → FAINT → WARM → HOT`. Walk around; when it reads HOT the landmark is
  within a few tiles. No arrow, no exact distance — just enough to close the gap.
- **Puzzles never hard-block you.** From City 4 the clues carry word / code / symbol-sequence
  locks. Miss three times and the panel starts coaching you; miss five and it tells you the
  answer. A quiz can slow a run down, not end it.
- Watch your **hunger and thirst**: drink free at fountains, buy food at shops with **$DLI**.
  Collapsing restarts the city from Day 1.
- Collect **$DLI** tokens scattered around the streets (they disappear once picked up).
- **Opening help only**: at City 1–5 the first **two** clues of a chain are also pointed at with a
  compass arrow and a live block count, and the riddle names a direction ("the bar, 17 blocks
  east"). From City 6 onward that extra help is gone: the hint line and signal meter replace it.
- **Guards patrol** with vision cones. They're sharper at night — hide (H) in bushes and crates,
  or slip past. Getting caught costs you the day.
- **Sleep on benches** — nights on the street take a toll.
- Days get shorter and guards get meaner as you push east. From **City 30** puzzles get harder.
- Every city is **bigger than the last** (38x30 tiles out of the gate, 84x66 by the border) and
  hides **more clues** (2 at City 1, rising to 9 by City 100), so the chain gets longer and the
  search gets wider.
- Already-used things read as used: bins sit **open and empty**, houses go dark with the door
  **shut**, landmarks you've talked to get **crossed out**, and collected clues get a **green
  check**.
- Unsolved chains read as **scrambled signal** — the text resolves into plain language once you
  find the first clue in a city. Region lore resolves the same way once a whole region is cleared.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Shift | Run |
| E | Interact / talk / search |
| Space | Climb fences & crates |
| H | Hide |
| F / G | Eat / drink |
| T | Sleep (near a bench) |

Touch controls appear automatically on mobile: drag the joystick to move, push it to the edge to
run, tap the action buttons on the right.

## Look & feel

The world is a **neon dusk city**, not a blackout: mid-tone indigo/teal street palettes per region,
bright lit windows, glowing rims on every interactive prop, magenta/cyan accents and soft
red-orange guard cones.

The city is drawn as **raised blocks, not flat squares**. Every building tile carries a lit roof
face, a two tone parapet ring, skylights and rooftop clutter (AC units, hatches, water tanks over a
shaded south wall with lit windows), and every block that faces open ground gets a **flight of
stairs** out of its doorway, so you can read the height of a building from the street. Contact
shadows sit under the south and east faces, and blocks are painted back to front so a nearer block
overlaps the wall of the one behind it. Every prop follows the same rule: trees, bushes, benches,
fountains, crates, fences, dumpsters, stalls, water towers and the clue landmarks
(shops, bars, houses, boards, radios, graffiti, kids) are all boxes with a top face and a front
face rather than icons.

**Streets read as streets.** The road is asphalt with a sheen band, worn **gutters** and a painted
**edge line** where it meets the kerb, a **dashed centre line** down the middle of each street,
**zebra crossings** on the tiles either side of every intersection (the bars run with the traffic
and are repeated across the road), a painted **box around the junction** itself, plus manhole
covers and patched asphalt scattered by a deterministic per tile hash. Pavements are neutral stone
slabs with a bright kerb lip along every street edge, so pavement, plaza, park, water and road each
read differently at a glance.

Each city day opens at **06:00 in full sun** and darkens as the play goes on, so the afternoon fades
into a violet night wash and the light climbs back just before the next sunrise (no hard cut).
Measured mean frame luminance is ≈ 96–122/255 in daylight and ≈ 62–75/255 at night, and both floors
are asserted by the self-test. Night still changes how the guards see: a shorter but wider cone,
and a quicker step. HUD panels sit on soft scrims so they stay readable over lit pavement, and the
hero carries their own light plus a contact shadow so the mascot reads against bright and dark
ground alike.

## Profile & save system

Local-only, no backend, key `borderrun_profile` in `localStorage` plus a second key
`borderrun_records` for ranking times.

- First load: onboarding for the display name + avatar skin, then the **main menu**.
- The main menu carries **Play**, **Settings**, **How to play?** and **Ranking**, plus the world map.
- Return visits land on that same menu, with **Continue** and **Start new run** in place of Play, so
  a paused run resumes exactly where it stopped (hunger, thirst, coins and clue progress included).
- **Settings** renames the runner and swaps the avatar skin; both write straight to the live save.
- **How to play** is the in-game manual: the goal, the loop of a city, survival, guards, the light
  and the ranking.
- **Ranking** keeps the fastest clear of every level the player has finished, plus completed full
  runs, in `borderrun_records`.
- Autosaves on city completion, day rollover, sleep, death and every 10 seconds of live play.
- **Reset profile** clears everything (progress, stats, lore and ranking times) and lives in
  Settings.
- All storage access is wrapped in try/catch: unreadable or corrupt data falls back to a fresh
  in-memory profile, so the game always runs even with storage blocked.

## Save integrity & the cheat surface

This is a single-player, offline, client-side game. There is no server, no leaderboard and no
economy, so "hacking" it can only ever affect your own device. That said, the obvious holes are
closed:

| Hole | Status |
| --- | --- |
| **Console backdoor** — `window.game` used to expose the live engine in production, so anyone could run `game.grantClue(0)` or set `hasPass = true` | **Closed.** The handle is created only under `import.meta.env.DEV`; the production bundle contains no `window.game` and no `__dilimaze`, and the whole self-test module is tree-shaken out (verified by grepping the built bundle). |
| **Hand-edited progress** — set `bestCity: 100` in devtools and skip 99 cities | **Detected.** Every save carries an FNV-1a **fingerprint** (`sig` + `sigv`) over a canonical projection of the payload. A present, current-generation fingerprint that doesn't match means the save was edited by something other than `saveProfile()` — progress is wiped, the name is kept, and the onboarding screen explains why. |
| **Prototype pollution** — a crafted payload with `"__proto__"` / `"constructor"` keys in `lore` | **Closed.** Nothing is copied through blindly: lore is rebuilt from a whitelist of region ids, and every field is re-created with explicit types. |
| **Oversized / corrupt payload** — a multi-megabyte or malformed value that hangs or crashes boot | **Closed.** The value is size-capped (64 KB) *before* `JSON.parse`, and oversized values are deleted. A malformed payload is replaced by a fresh profile and the pre-profile legacy save is migrated once. |
| **Name injection** — markup, control characters, zero-width or RTL-override characters in the display name to spoof the UI | **Closed.** Names are stripped of control/bidi/zero-width characters and `<>`, collapsed, and capped at 18 characters. (React already escapes text, so this was cosmetic — but it also keeps the fingerprint stable.) |
| **Brute-forcing a puzzle** — a handful of guesses beats any riddle | **Mitigated by design.** Puzzles coach after 3 misses and hand over the answer after 5, so there is no incentive to script them; the blocking (which city you're in) still has to be earned. |
| **Fingerprint forgery** — the salt ships in the bundle, so a determined user can recompute it | **Out of scope by design.** A client-authoritative save can't be made cheat-proof; the fingerprint stops casual edits, not a determined reverse engineer. Server authority would be the real fix and there is no server. |

Two rules keep this honest for real players: the **only** destructive path is an exact fingerprint
mismatch (a heuristic once flagged a genuine legacy-migrated save and wiped it — see the
regression test), and anything structurally odd is *repaired* rather than deleted (a mid-run state
for a city you never reached is dropped, not the save).

## Dev self-test

`src/devtools/selftest.ts` plays the real game and is loaded **only in dev builds**. Run it from
the browser console, or from the preview tooling:

```js
await window.__dilimaze.runSelfTest()
```

80 checks, ~2s, all wired to the real modules (no mocks). It covers:

- **Generation** — all 100 cities: map size matches the curve and grows monotonically, clue count
  matches the ramp, every clue points at a real unique landmark, every riddle/hint is present,
  every puzzle is internally solvable (the scrambled board really is an anagram of the answer),
  every city has guards *and* somewhere to hide, and generation is deterministic but varied.
- **Solvability** — a flood fill from the spawn reaches every clue and the gate in all 100 cities.
  Generation also reserves the spawn and gate tiles, refuses to let clutter seal a pocket, and
  runs a repair pass, so `solvabilityFixes` should stay 0.
- **Progression** — plays all 100 cities through the real engine: gate opens only with a pass,
  the city advances, region lore unlocks every 20 cities, $DLI carries across borders, City 100
  ends in victory.
- **Survival / guards** — starving collapses you and restarts the city on Day 1; a chasing guard
  catches you; hiding in cover keeps you safe.
- **Puzzles** — interacting with a chain landmark opens its lock, wrong answers keep it open, the
  coaching line appears on schedule, the right answer advances the chain, and an out-of-order
  landmark is a dead end. Also asserts the HUD riddle matches the clue you are hunting.
- **Rendering** — every region × every pose × day/night renders without throwing, plus measured
  frame brightness (day ≥ 80/255, night ≥ 55/255, night < day) so a future palette change can't
  quietly darken the game again. A separate check walks the arc: a city opens in full sun, darkens
  through dusk into night, and lifts again before the next sunrise.
- **Ranking records** — a level timer is banked and only a faster clear replaces it, junk times and
  out of range cities are refused, a crafted board cannot pollute `Object.prototype`, an oversized
  board is dropped fast, and the engine really does bank a time when a city is cleared.
- **Saves & security** — round-trip fidelity, an honest save is never flagged, legacy
  fingerprint-less saves are accepted, legacy-migrated saves (high `bestCity`, low clears) are
  **not** wiped, hand-edited and plausibly-edited saves **are** caught, corrupt/oversized payloads
  are rejected fast, `Object.prototype` can't be polluted, and names are sanitized.

If you are running it by hand, do it from the menu rather than mid-run: it writes to
`localStorage` while testing and restores your save afterwards.

## Project layout

```
src/
  game/
    brand.ts      Dlicom brand kit: names, colors, avatar skins (+ art + sprite hook)
    character.ts  the ONLY place the mascot is drawn — art, tints, poses, preview
    city.ts       5 regions x 20 cities, generation, clue chains, hints, solvability guard
    engine.ts     game loop, player, guards, survival, clues, day arc, level timer, checkpoints
    render.ts     neon canvas world renderer: raised 3D blocks, street design, props
    profile.ts    localStorage profile, integrity fingerprint, migration, sanitisation
    records.ts    local ranking board: fastest clear per level + completed full runs
    types.ts      shared types
    rng.ts        seeded RNG
  devtools/
    selftest.ts   dev-only self-test harness (tree-shaken out of production)
  assets/
    dlicom.png    the mascot sprite (cropped + transparent, 58x44)
    youre-gone.otf  display face
    the-bomb-sound.otf  popup/dialog face
  ui/
    Onboarding.tsx  name + avatar picker (with live canvas previews)
    MainMenu.tsx    the hub: Play or Continue, Settings, How to play?, Ranking, world map
    Settings.tsx    rename the runner, swap the avatar, reset the profile
    HowToPlay.tsx   the in-game manual
    Ranking.tsx     fastest clear per level + best full runs
    WorldMap.tsx    region/city select with fogged unreached cities + region lore files
    GlitchText.tsx  scrambled-until-unlocked copy
    HUD.tsx         HUD, foldable clue bar + riddle + locator hint, signal meter, toasts
    Menus.tsx       dialog / puzzle / caught / cleared / victory overlays
    TouchControls.tsx  joystick + action buttons
  App.tsx  screen flow: onboarding → menu → (settings | how to play | ranking | map) → game
  index.css  Dlicom neon theme (mirrors brand.ts colors)
```

## Fully functional now

- 5 regions × 20 procedurally generated cities (100 total), every one reachable end to end
- Clue chains → riddle → hint → puzzle → border pass → east gate → next city
- In-clue locator hints on every clue, a first-lead line per city, and a proximity signal meter
  once the opening arrow stops — the search is never blind
- Puzzle coaching after 3 misses and a giveaway after 5, so riddles can't block a run
- Bright neon-dusk world (measured frame luminance in the self-test) with legible night
- A 3D read on the whole map: raised building blocks with walls, roofs, parapets and entrance
  stairs, plus a rebuilt road design (kerbs, gutters, lane dashes, zebra crossings, junction
  boxes, manholes)
- A clue panel that stays out of the way: one folded bar with the clue count, signal meter and a
  single line of the riddle, which unfolds by itself when a clue lands and folds back after a few
  seconds, with a chevron to pin it either way
- Difficulty ramp: opening clues sit close together with explicit directions at City 1–5, then
  scatter and go vague; puzzles from City 4, harder from City 30
- Cities grow every level (38x30 → 84x66) and hide more clues (2 → 9)
- Survival loop: hunger, thirst, health, $DLI, shops, market stalls, fountains, benches, sleep
- Pickups and spent props read as such: collected clues get a green check, talked-to landmarks
  get crossed out, searched bins sit open and empty, shut houses go dark, $DLI tokens vanish
- Guard patrols, vision cones, chase/search, hiding, climbing
- A day arc: each city opens in full sun at 06:00 and darkens into violet night as the play goes on
- Main menu after naming: Play, Settings, How to play? and Ranking, with Continue and Start new
  run for a returning player
- Level timers: every city clear is timed, and the ranking board keeps your fastest clear per level
  plus your best full run from City 1 to City 100
- Profile system: onboarding, main menu, autosave, reset, corrupt-save recovery, tamper
  detection, legacy migration
- World map with fogged locked cities, replay of reached cities, region lore unlocks
- Real Dlicom mascot art, sliced and posed in code: alternating footfalls (one foot always
  planted), eyes that look where he's going and blink, plus crouch / climb / sleep / interact
- "You're Gone" display face (public domain, 1001 Fonts) across titles, buttons, HUD and labels
- Keyboard + touch controls, high-DPI canvas, safe-area aware mobile layout
- Auto-deploy to GitHub Pages on push to `main`

## Placeholder (swap when the real assets land)

- **Brand colors** — `BRAND.colors` in `src/game/brand.ts` are eyeballed from the mascot art.
  Change the hexes there and the entire game re-themes. Region street palettes live in
  `REGIONS` in `src/game/city.ts`.
- **Display fonts** — `src/assets/youre-gone.otf` (You're Gone by 1001 Fonts, public domain) is
  caps-only, so it's applied to uppercase UI and canvas labels via `DISPLAY` in `render.ts`.
  Popup/dialog copy uses `src/assets/the-bomb-sound.otf` (`--font-popup`). Swap either file and
  the `@font-face` name in `index.css` to change it.
- **Region lore copy** — the `lore` / `hook` strings in `src/game/city.ts` are marked
  `PLACEHOLDER LORE`. Replace the text, the unlock plumbing already works.
- **Avatar art** — the shipped PNG lives at `src/assets/dlicom.png` (cropped, transparent,
  58x44) and is pointed at by `MASCOT_ART` in `brand.ts`. To drop in new art, replace that file
  (or change the URL / `height`) — nothing else needs touching. For a real animated sheet, set
  `sprite` (`url`, `frameW`, `frameH`, `cols`, `fps`, `poseRows`) on a skin instead; `character.ts`
  blits frames rather than posing a single image.
- **Skins** — `SKINS` holds four variants (Dlicom, Neon, Ghost, Sunset). They share the one PNG
  and are recolored at load with a canvas `color` blend (`tint`), so adding a variant is one
  entry. The canvas-drawn mascot is still in `character.ts` as the fallback if the PNG can't load.
- **Sound** — `profile.settings.sound` is still stored in the profile but no audio is wired up and
  Settings does not surface it yet.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5180/.

Other scripts: `npm run build` (typecheck + production bundle), `npm run build:pages` (same, with
`--base=/DILIMAZE/` for the GitHub Pages deploy — the base must match the repo name).

## Tech

Vite + React + TypeScript, canvas rendering, zero game-engine dependencies. No image assets are
fetched at runtime — the one PNG is imported through Vite so it works under the GitHub Pages
subpath. The dev-only self-test is excluded from production builds by `import.meta.env.DEV`.
