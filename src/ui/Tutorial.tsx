import { useState } from 'react'
import { BRAND } from '../game/brand'

/**
 * The first time tutorial. It runs before the first city of a new player's run —
 * the moment they press Play — and it walks them through the six things the run
 * actually asks for, in the order the game asks for them. Shown once, then
 * replayable from Settings and from the manual.
 *
 * Every illustration is a small inline SVG so the panel needs no assets and
 * keeps working offline.
 */

type ArtKind = 'keys' | 'clue' | 'puzzle' | 'gate' | 'bars' | 'guard'

interface Step {
  title: string
  art: ArtKind
  body: string[]
  keys?: Array<[string, string]>
}

const STEPS: Step[] = [
  {
    title: 'You are smuggling one runner to freedom',
    art: 'keys',
    body: [
      'The route runs from City 1 to City 100. Clear a city by following its clue trail, taking the border pass, then walking off the east edge.',
      'Walk with the arrow keys or W A S D. Hold Shift to run, but running burns food and water faster.',
    ],
    keys: [
      ['W A S D', 'Walk'],
      ['Shift', 'Run'],
    ],
  },
  {
    title: 'Follow the clue trail',
    art: 'clue',
    body: [
      'Each city hides a handful of clues on marked places: notice boards, bars, radios, kids on the street and painted walls. Stand next to one and press E to search it.',
      'Every clue hands you a riddle that points at the next one. The SIGNAL meter warms up as you close in, and in the opening cities a tracker arrow aims you straight at it.',
    ],
    keys: [
      ['E', 'Search, talk, use'],
      ['H', 'Hide in cover'],
      ['Space', 'Climb'],
    ],
  },
  {
    title: 'Sealed clues open a puzzle',
    art: 'puzzle',
    body: [
      'From the fourth city on, some clues are sealed and open a small puzzle: unscramble a word, do the coded sum, or tap symbols back in order.',
      'Wrong answers cost you nothing. After three tries the panel starts coaching you, and after five it hands the answer over. Nobody gets stuck on a quiz.',
    ],
  },
  {
    title: 'Take the pass and run east',
    art: 'gate',
    body: [
      'Find every clue in a city and the border pass is granted. With the pass in hand the east gate opens and the next city unlocks.',
      'Every city is on a clock that counts toward the ranking board, so a clean and quick route is worth more than a slow and safe one.',
    ],
  },
  {
    title: 'Your bars carry from city to city',
    art: 'bars',
    body: [
      'Food, Water and Health drain as the day runs. Eat with F, drink with G, and pocket the bread and water you find. $DLI tokens are picked up on contact, so just walk over them. Sleep on a bench with T to jump to the next morning.',
      'The bars do NOT refill when you reach a new city. Whatever you have left crosses the border with you, so spend what you find and leave a little in reserve.',
    ],
    keys: [
      ['F', 'Eat'],
      ['G', 'Drink'],
      ['T', 'Sleep'],
    ],
  },
  {
    title: 'Never let a guard finish their look',
    art: 'guard',
    body: [
      'Guards walk fixed routes behind a vision cone. If the cone reaches you they give chase, search you, and take coins and food.',
      'The deeper you go the heavier the patrols get. Some watch a long way down a street, some sweep a whole corner at once, and in the later cities some of them carry a weapon and will shoot you: break the line of sight behind a building, a bush or a crate.',
      'Hide in a bush or a dumpster with H, climb a crate or a wall with Space, and use the night: cones are shorter after dark, but guards move faster.',
    ],
  },
]

function Art({ kind }: { kind: ArtKind }) {
  const C = BRAND.colors
  const common = { fill: 'none', stroke: C.cyan, strokeWidth: 2, strokeLinecap: 'round' as const }
  switch (kind) {
    case 'keys':
      return (
        <svg viewBox="0 0 120 74" className="tut-art" aria-hidden="true">
          <rect x="34" y="6" width="14" height="14" rx="3" {...common} />
          <rect x="14" y="26" width="14" height="14" rx="3" {...common} />
          <rect x="34" y="26" width="14" height="14" rx="3" {...common} />
          <rect x="54" y="26" width="14" height="14" rx="3" {...common} />
          <rect x="34" y="46" width="14" height="14" rx="3" {...common} />
          <text x="41" y="18" className="tut-art-key">
            W
          </text>
          <text x="21" y="38" className="tut-art-key">
            A
          </text>
          <text x="41" y="38" className="tut-art-key">
            S
          </text>
          <text x="61" y="38" className="tut-art-key">
            D
          </text>
          <path d="M82 37 h22 m0 0 l-6 -5 m6 5 l-6 5" {...common} />
          <circle cx="96" cy="37" r="7" fill={C.gold} />
        </svg>
      )
    case 'clue':
      return (
        <svg viewBox="0 0 120 74" className="tut-art" aria-hidden="true">
          <rect x="10" y="16" width="30" height="34" rx="4" {...common} />
          <path d="M14 24 h22 M14 32 h22 M14 40 h14" stroke={C.magentaSoft} strokeWidth="2" strokeLinecap="round" />
          <circle cx="25" cy="58" r="6" fill={C.gold} />
          <path d="M46 33 h14 m0 0 l-5 -5 m5 5 l-5 5" {...common} />
          <rect x="66" y="10" width="44" height="40" rx="6" stroke={C.gold} strokeWidth="2" fill="none" />
          <path d="M72 22 h30 M72 30 h30 M72 38 h18" stroke={C.cyan} strokeWidth="2" strokeLinecap="round" />
          <text x="66" y="64" className="tut-art-note">
            the next line
          </text>
        </svg>
      )
    case 'puzzle':
      return (
        <svg viewBox="0 0 120 74" className="tut-art" aria-hidden="true">
          <rect x="16" y="14" width="88" height="46" rx="8" {...common} />
          <rect x="26" y="24" width="18" height="18" rx="3" stroke={C.gold} strokeWidth="2" />
          <rect x="50" y="24" width="18" height="18" rx="3" stroke={C.magentaSoft} strokeWidth="2" />
          <rect x="74" y="24" width="18" height="18" rx="3" stroke={C.cyan} strokeWidth="2" />
          <path d="M26 52 h60" stroke={C.good} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'gate':
      return (
        <svg viewBox="0 0 120 74" className="tut-art" aria-hidden="true">
          <path d="M8 60 h104" stroke={C.magentaSoft} strokeWidth="2" />
          <path d="M88 12 v48 M112 12 v48" stroke={C.gold} strokeWidth="3" />
          <path d="M88 18 h24" stroke={C.gold} strokeWidth="3" />
          <path d="M16 44 h44 m0 0 l-8 -6 m8 6 l-8 6" {...common} />
          <circle cx="80" cy="44" r="7" fill={C.gold} />
        </svg>
      )
    case 'bars':
      return (
        <svg viewBox="0 0 120 74" className="tut-art" aria-hidden="true">
          {[
            ['Health', C.good, 0.72],
            ['Food', C.warn, 0.46],
            ['Water', C.cyan, 0.31],
          ].map(([label, colour, frac], i) => (
            <g key={String(label)}>
              <text x="10" y={22 + i * 20} className="tut-art-note">
                {label}
              </text>
              <rect x="48" y={12 + i * 20} width="60" height="9" rx="4" fill="rgba(255,255,255,0.12)" />
              <rect x="48" y={12 + i * 20} width={60 * Number(frac)} height="9" rx="4" fill={String(colour)} />
            </g>
          ))}
          <text x="10" y="70" className="tut-art-note">
            carried into the next city
          </text>
        </svg>
      )
    case 'guard':
    default:
      return (
        <svg viewBox="0 0 120 74" className="tut-art" aria-hidden="true">
          <path d="M24 38 L96 14 L96 62 Z" fill="rgba(255,80,80,0.28)" stroke="rgba(255,90,90,0.6)" strokeWidth="1.5" />
          <circle cx="24" cy="38" r="9" fill={C.magentaSoft} />
          <rect x="88" y="30" width="10" height="10" rx="2" fill="rgba(255,255,255,0.25)" />
          <circle cx="30" cy="60" r="7" stroke={C.cyan} strokeWidth="2" fill="none" />
          <text x="30" y="68" className="tut-art-note">
            hide
          </text>
        </svg>
      )
  }
}

interface TutorialProps {
  /** called when the player finishes or skips — the run starts after this */
  onDone: () => void
  /** true when replayed from a menu, so the last button says so instead */
  replay?: boolean
}

export function Tutorial({ onDone, replay = false }: TutorialProps) {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const last = i === STEPS.length - 1

  return (
    <div className="screen tutorial-screen">
      <div className="tutorial-panel">
        <div className="tutorial-head">
          <span className="tutorial-count">
            {replay ? 'TUTORIAL' : 'HOW TO PLAY, QUICK TOUR'} {i + 1}/{STEPS.length}
          </span>
          <button className="ghost" onClick={onDone}>
            {replay ? 'Close' : 'Skip the tour'}
          </button>
        </div>

        <h2 className="tutorial-title">{step.title}</h2>

        <div className="tutorial-body">
          <Art kind={step.art} />
          <div className="tutorial-copy">
            {step.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {step.keys && (
              <div className="tutorial-keys">
                {step.keys.map(([key, what]) => (
                  <div key={key} className="tutorial-key">
                    <kbd>{key}</kbd>
                    <span>{what}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="tutorial-foot">
          <div className="tutorial-dots" aria-hidden="true">
            {STEPS.map((s, d) => (
              <span key={s.title} className={d === i ? 'on' : d < i ? 'done' : ''} />
            ))}
          </div>
          <div className="tutorial-buttons">
            <button className="ghost" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
              Back
            </button>
            {last ? (
              <button className="primary" onClick={onDone}>
                {replay ? 'Back to the menu' : 'Start the run'}
              </button>
            ) : (
              <button className="primary" onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
