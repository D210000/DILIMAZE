import { useRef, useState } from 'react'
import { BRAND } from '../game/brand'
import type { Game, Snapshot } from '../game/engine'

interface MenusProps {
  snap: Snapshot
  gameRef: React.RefObject<Game | null>
  onNew: () => void
}

export function Menus({ snap, gameRef, onNew }: MenusProps) {
  const g = gameRef.current!
  const [wordAnswer, setWordAnswer] = useState('')
  const [codeAnswer, setCodeAnswer] = useState('')
  const [seqPick, setSeqPick] = useState<number[]>([])
  const wordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  // After a wrong answer the puzzle stays open; put the caret back so typing keeps working
  const refocus = (r: React.RefObject<HTMLInputElement | null>) => setTimeout(() => r.current?.focus(), 0)

  if (snap.status === 'dialog' && snap.dialog) {
    const isRegionLore = snap.dialog.title.startsWith('REGION CLEARED') || snap.dialog.title.startsWith('AGAIN')
    return (
      <div className={`overlay${isRegionLore ? ' lore' : ''}`}>
        <div className="panel">
          <h2>{snap.dialog.title}</h2>
          {snap.dialog.lines.map((l, i) => (
            <p key={i} className={isRegionLore ? 'lore-text' : undefined}>
              {l}
            </p>
          ))}
          {isRegionLore && <p className="hint">Region file added to the world map.</p>}
          <button className="primary" onClick={() => g.closeDialog()}>
            Continue (Enter)
          </button>
        </div>
      </div>
    )
  }

  if (snap.status === 'puzzle' && snap.puzzle) {
    const pz = snap.puzzle.puzzle
    return (
      <div className="overlay">
        <div className="panel">
          <h2>🔓 Signal Lock</h2>
          {/* after a few misses the panel starts coaching — never a dead stop */}
          {snap.puzzle.nudge && <p className="puzzle-nudge">💡 {snap.puzzle.nudge}</p>}
          {pz.kind === 'word' && (
            <>
              <p className="puzzle-body">{pz.scrambled}</p>
              <p className="hint">{pz.hint}</p>
              <input
                autoFocus
                ref={wordRef}
                value={wordAnswer}
                placeholder="answer"
                onChange={(e) => setWordAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    g.answerPuzzle(wordAnswer)
                    setWordAnswer('')
                    refocus(wordRef)
                  }
                }}
              />
              <button
                className="primary"
                onClick={() => {
                  g.answerPuzzle(wordAnswer)
                  setWordAnswer('')
                  refocus(wordRef)
                }}
              >
                Try
              </button>
            </>
          )}
          {pz.kind === 'code' && (
            <>
              <p className="puzzle-body">{pz.prompt}</p>
              <input
                autoFocus
                ref={codeRef}
                value={codeAnswer}
                placeholder="code"
                inputMode="numeric"
                onChange={(e) => setCodeAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    g.answerPuzzle(codeAnswer)
                    setCodeAnswer('')
                    refocus(codeRef)
                  }
                }}
              />
              <button
                className="primary"
                onClick={() => {
                  g.answerPuzzle(codeAnswer)
                  setCodeAnswer('')
                  refocus(codeRef)
                }}
              >
                Try
              </button>
            </>
          )}
          {pz.kind === 'sequence' && (
            <>
              <p className="hint">
                The radio hummed a pattern. Tap the symbols in the order it played, left to right.
              </p>
              <div className="seq-row">
                {pz.shown.map((s, i) => (
                  <button
                    key={i}
                    className="seq-btn"
                    onClick={() => {
                      const next = [...seqPick, i]
                      if (next.length === pz.answer.length) {
                        g.answerPuzzle(next)
                        setSeqPick([])
                      } else setSeqPick(next)
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="seq-progress">{seqPick.map((i) => pz.shown[i]).join(' → ') || '...'}</p>
              <button onClick={() => setSeqPick([])}>Clear</button>
            </>
          )}
          <button className="ghost" onClick={() => g.cancelPuzzle()}>
            Step away
          </button>
        </div>
      </div>
    )
  }

  if (snap.status === 'caught') {
    return (
      <div className="overlay red">
        <div className="panel">
          <h2>🚨 CAUGHT!</h2>
          <p>They searched you and sent you back.</p>
          <p className="hint">Lose coins, food... and time.</p>
        </div>
      </div>
    )
  }

  if (snap.status === 'collapsed') {
    return (
      <div className="overlay red">
        <div className="panel">
          <h2>💀 COLLAPSED</h2>
          <p>{snap.deathReason || 'Your body gave out.'}</p>
          <p className="hint">Restarting City {snap.city} from Day 1...</p>
        </div>
      </div>
    )
  }

  if (snap.status === 'cityCleared') {
    return (
      <div className="overlay gold">
        <div className="panel">
          <h2>✔ CITY {snap.city} CLEARED</h2>
          <p>
            {snap.city === 100
              ? 'The last gate... beyond it, freedom.'
              : `Crossing into City ${snap.city + 1}...`}
          </p>
          <p className="hint">Days spent here: {snap.daysInCity}</p>
        </div>
      </div>
    )
  }

  if (snap.status === 'victory') {
    return (
      <div className="overlay gold">
        <div className="panel">
          <h2>🌍 OUT OF THE COUNTRY</h2>
          <p>
            {snap.playerName} crossed all 100 cities of {BRAND.game} {BRAND.gameLine2} and left the country.
          </p>
          <p className="hint">
            Days on the road: {snap.totalDays} · Close calls: {snap.deaths}
          </p>
          <button className="primary" onClick={onNew}>
            Run it again
          </button>
        </div>
      </div>
    )
  }

  return null
}
