import { useEffect, useRef, useState } from 'react'
import { BRAND } from '../game/brand'
import type { Snapshot } from '../game/engine'
import { fmtClock } from '../game/records'
import { drawCharacter } from '../game/character'
import { MAX_LIVES } from '../game/profile'
import { GlitchText } from './GlitchText'

const C = BRAND.colors

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
  const [open, setOpen] = useState(false)
  const lifeCanvases = useRef<Array<HTMLCanvasElement | null>>([])
  useEffect(() => setOpen(false), [snap.cluesFound, snap.city, snap.hasPass])
  useEffect(() => {
    lifeCanvases.current.forEach((canvas, index) => {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = 36 * dpr
      canvas.height = 36 * dpr
      ctx.scale(dpr, dpr)
      const alive = index < snap.livesRemaining
      ctx.save()
      if (!alive) {
        ctx.filter = 'grayscale(1)'
        ctx.globalAlpha = 0.42
      }
      drawCharacter(ctx, { x: 18, y: 30, facing: Math.PI / 2, pose: 'idle', anim: 0, skin: snap.skin, scale: 0.68, noRim: true })
      ctx.restore()
      if (!alive) {
        ctx.strokeStyle = 'rgba(255,90,125,.95)'
        ctx.lineWidth = 2.4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(10, 9); ctx.lineTo(26, 26)
        ctx.moveTo(26, 9); ctx.lineTo(10, 26)
        ctx.stroke()
      }
    })
  }, [snap.skin, snap.livesRemaining])

  const bar = (label: string, v: number, color: string) => (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{Math.round(v)}%</span>
      <div className="stat-bar">
        <div className="stat-fill" style={{ width: `${v}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
    </div>
  )

  const lowHealth = snap.health < 30
  const riddle = snap.clueHint || 'SIGNAL UNRESOLVED'
  const cityHue = ((snap.city - 1) * 137.508) % 360

  return (
    <div className="hud">
      <div className="hud-top-left">
        <div className="hud-title" style={{ color: `hsl(${cityHue} 82% 76%)` }}>
          CITY {snap.city}/100
        </div>

        <div className="hud-bottom-left">
          <div className="clue-bar">
            <button
              className="clue-count"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Hide clue details' : 'Show clue details'}
              title={open ? 'Hide clue details' : 'Show clue details'}
              disabled={snap.hasPass}
            >
              CLUES {snap.cluesFound}/{snap.cluesTotal}
            </button>
            {snap.signal && !snap.hasPass && open && (
              <span className={`signal signal-${snap.signal}`}>
                <span className="signal-label">SIGNAL {SIGNAL_LABEL[snap.signal]}</span>
                <span className="signal-bars" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <i key={i} className={i < SIGNAL_LEVEL[snap.signal!] ? 'on' : ''} />
                  ))}
                </span>
              </span>
            )}
          </div>

          {open && !snap.hasPass && (
            <div className="clue-detail">
              <div className="clues">
                <GlitchText text={riddle} locked={!snap.clueKnown} />
              </div>
              {(snap.clueKnown ? snap.clueHintLine : snap.clueEntry) && (
                <div className="clue-hint">{snap.clueKnown ? snap.clueHintLine : snap.clueEntry}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="hud-timer" title="Level timer, counted for the ranking">
        ⏱ {fmtClock(snap.cityTimeSec)}
      </div>

      <div className="hud-top-right">
        {bar('Health', snap.health, lowHealth ? C.bad : C.good)}
        {bar('Food', snap.hunger, snap.hunger < 25 ? C.bad : C.warn)}
        {bar('Water', snap.thirst, snap.thirst < 25 ? C.bad : C.cyan)}
        <div className="inv">
          🍞 {snap.food} · 💧 {snap.water} · <span className="dli">$DLI {snap.coins}</span>
        </div>
        <div className="life-meter" aria-label={`${snap.livesRemaining} of ${MAX_LIVES} lives remaining, ${snap.bankedLives} reserve lives`}>
          {Array.from({ length: MAX_LIVES }, (_, life) => (
            <span className={`life-icon${life < snap.livesRemaining ? ' alive' : ' spent'}`} key={life}>
              <canvas ref={(node) => { lifeCanvases.current[life] = node }} aria-hidden="true" />
            </span>
          ))}
          {snap.bankedLives > 0 && <span className="reserve-life-count" title="Saved lives for when this city's lives run out">+{snap.bankedLives}</span>}
        </div>
      </div>

      {snap.hasPass && <div className="hud-alerts pass-badge">BORDER PASS: RUN EAST</div>}
      {snap.guardsAlerted > 0 && (
        <div className="hud-alerts alert-badge">🚨 CHASED BY {snap.chasedBy.toUpperCase()}!</div>
      )}
      {snap.shotsAtYou > 0 && (
        <div className="hud-alerts alert-badge under-fire">🔫 UNDER FIRE, BREAK LINE OF SIGHT!</div>
      )}
      {snap.nearSafehouse && !snap.hasPass && <div className="hud-alerts safe-badge">🛏 Safe to sleep (T)</div>}

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
