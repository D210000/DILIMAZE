import { useEffect, useRef, useState } from 'react'
import { BRAND, SKINS } from '../game/brand'
import { drawCharacterPreview } from '../game/character'

/** Live canvas preview of the mascot for one skin. */
export function SkinPreview({ skinId, size = 76 }: { skinId: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const loop = (t: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = size * dpr
      if (canvas.width !== px) {
        canvas.width = px
        canvas.height = px
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawCharacterPreview(ctx, skinId, size, size, t / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [skinId, size])

  return <canvas ref={ref} className="skin-canvas" style={{ width: size, height: size }} />
}

export function SkinPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="skin-grid">
      {SKINS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`skin-card${s.id === value ? ' selected' : ''}`}
          onClick={() => onChange(s.id)}
          style={{ borderColor: s.id === value ? s.accent : undefined }}
        >
          <SkinPreview skinId={s.id} />
          <span className="skin-name">{s.name}</span>
        </button>
      ))}
    </div>
  )
}

interface OnboardingProps {
  onStart: (name: string, skin: string) => void
  initialSkin?: string
  /** shown once if a corrupt save was replaced */
  recovered?: boolean
  /** shown once if an edited save failed its integrity check */
  tampered?: boolean
  storageOk?: boolean
}

export function Onboarding({ onStart, initialSkin, recovered, tampered, storageOk }: OnboardingProps) {
  const [name, setName] = useState('')
  const [skin, setSkin] = useState(initialSkin ?? SKINS[0].id)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const skinDef = SKINS.find((s) => s.id === skin) ?? SKINS[0]
  const submit = () => onStart(name.trim() || 'Runner', skin)

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="brand-strip">
          <span className="brand-mark">DLICOM</span>
        </div>

        <h1 className="game-title">{BRAND.game}</h1>
        <p className="game-sub">{BRAND.gameLine2}</p>
        <p className="tagline">{BRAND.tagline}</p>

        <div className="panel onboarding-panel">
          <h2>Create your runner</h2>
          <p className="hint">
            Progress is saved on this device only. No account, no servers. You can reset it any time.
          </p>

          <label className="field-label" htmlFor="runner-name">
            Display name
          </label>
          <input
            id="runner-name"
            ref={inputRef}
            value={name}
            maxLength={14}
            placeholder="Runner"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />

          <label className="field-label">Avatar</label>
          <SkinPicker value={skin} onChange={setSkin} />
          <p className="hint skin-blurb">{skinDef.blurb}</p>

          <button className="primary wide" onClick={submit}>
            Continue
          </button>
          <p className="hint">Next you pick Play from the menu, and you can change all of this later in Settings.</p>

          {tampered && (
            <p className="hint warn-line">
              That save had been edited by hand. Progress was reset to keep the run honest. Your name was kept.
            </p>
          )}
          {recovered && !tampered && (
            <p className="hint warn-line">A damaged save was found and replaced with a fresh one.</p>
          )}
          {storageOk === false && (
            <p className="hint warn-line">
              Local storage is unavailable. You can play, but progress will not persist.
            </p>
          )}
        </div>

        <p className="controls-hint">
          WASD move · Shift run · E interact · Space climb · H hide · F eat · G drink · T sleep
        </p>
      </div>
    </div>
  )
}
