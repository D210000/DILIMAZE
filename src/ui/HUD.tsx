import { useEffect, useState } from 'react'
import { BRAND } from '../game/brand'
import type { Snapshot } from '../game/engine'
import { fmtClock } from '../game/records'
import { GlitchText } from './GlitchText'

const C = BRAND.colors

/** proximity readout for clues the tracker arrow does not pinpoint */
const SIGNAL_LABEL: Record<NonNullable<Snapshot['signal']>, string> = {
  cold: 'COLD',
  faint: 'FAINT',
  warm: 'WARM',
  hot: 'HOT',
}
const SIGNAL_LEVEL: Record<NonNullable<Snapshot['signal']>, number> = {
  cold: 1,
  faint: 2,
  warm: 3,
  hot: 4,
}

export function HUD({ snap }: { snap: Snapshot }) {
  /**
   * The clue block covers the street it is sitting on, so it stays folded down
   * to a single bar: the count, the signal meter and one line of the riddle.
   * It unfolds by itself whenever a new clue lands, because that is the moment
   * the text actually has to be read, then folds back after a few seconds so the
   * map underneath comes back into sight. The chevron pins it either way.
   */
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(true)
    const t = setTimeout(() => setOpen(false), 7000)
    return () => clearTimeout(t)
  }, [snap.cluesFound, snap.city, snap.hasPass])

  const bar = (label: string, v: number, color: string) => (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <div className="stat-bar">
        <div className="stat-fill" style={{ width: `${v}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  )

  const clock = `${String(snap.hour).padStart(2, '0')}:00 ${snap.night ? '☾' : '☀'}`
  const lowHealth = snap.health < 30
  const riddle = snap.clueHint || 'SIGNAL UNRESOLVED'

  return (
    <div className="hud">
      <div className="hud-top-left">
        <div className="hud-title">
          CITY {snap.city}/100 <span className="hud-sep">·</span> {snap.region.toUpperCase()}
        </div>
        <div className="hud-sub">
          {snap.playerName} · Day {snap.day} · {clock} · {snap.daysInCity}d here{' '}
          <span className="hud-timer" title="Level timer, counted for the ranking">
            ⏱ {fmtClock(snap.cityTimeSec)}
          </span>
        </div>
      </div>

      <div className="hud-top-right">
        {bar('Health', snap.health, lowHealth ? C.bad : C.good)}
        {bar('Food', snap.hunger, snap.hunger < 25 ? C.bad : C.warn)}
        {bar('Water', snap.thirst, snap.thirst < 25 ? C.bad : C.cyan)}
        <div className="inv">
          🍞 {snap.food} · 💧 {snap.water} · <span className="dli">$DLI {snap.coins}</span>
        </div>
      </div>

      {/* signal tracker: opening cities only, first two clues */}
      {snap.clueTrack && !snap.hasPass && (
        <div className="tracker">
          <span
            className="tracker-arrow"
            style={{ transform: `rotate(${snap.clueTrack.angle}rad)` }}
            aria-hidden="true"
          >
            ➤
          </span>
          <span className="tracker-text">
            clue · {snap.clueTrack.distanceTiles} blk
          </span>
        </div>
      )}

      <div className={`hud-bottom-left${open ? ' open' : ''}`}>
        <div className="clue-bar">
          <span className="clue-count">
            CLUES {snap.cluesFound}/{snap.cluesTotal}
          </span>
          {snap.hasPass && <span className="pass-badge">BORDER PASS: RUN EAST</span>}
          {snap.signal && !snap.hasPass && (
            <span className={`signal signal-${snap.signal}`}>
              <span className="signal-label">SIGNAL {SIGNAL_LABEL[snap.signal]}</span>
              <span className="signal-bars" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <i key={i} className={i < SIGNAL_LEVEL[snap.signal!] ? 'on' : ''} />
                ))}
              </span>
            </span>
          )}
          <button
            className="clue-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={open ? 'Fold the clue text away' : 'Show the full clue text'}
          >
            {open ? '⌄ fold' : '⌃ clue'}
          </button>
        </div>

        {!snap.hasPass && (
          <>
            {/* one line of the riddle while folded: the trail is never hidden */}
            {!open && <div className="clue-peek">{snap.clueKnown ? riddle : snap.clueEntry}</div>}
            {open && (
              <div className="clue-detail">
                <div className="clues">
                  <GlitchText text={riddle} locked={!snap.clueKnown} />
                </div>
                {/* the locator line: before the first clue it points at the opening
                    landmark, after that it travels with every riddle */}
                {(snap.clueKnown ? snap.clueHintLine : snap.clueEntry) && (
                  <div className="clue-hint">{snap.clueKnown ? snap.clueHintLine : snap.clueEntry}</div>
                )}
              </div>
            )}
          </>
        )}

        {snap.guardsAlerted > 0 && (
          <div className="alert-badge">🚨 CHASED BY {snap.chasedBy.toUpperCase()}!</div>
        )}
        {snap.nearSafehouse && !snap.hasPass && <div className="safe-badge">🛏 Safe to sleep (T)</div>}
      </div>

      {snap.promptText && <div className="prompt">{snap.promptText}</div>}

      <div className="toasts">
        {snap.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
