import { useEffect, useRef } from 'react'
import type { Game, Snapshot } from '../game/engine'

/**
 * The mobile stick. Touches are read raw, but the vector the game sees is eased
 * toward the newest touch every frame: phones deliver pointer moves in coarse
 * bursts, so feeding them straight through made the runner stutter. A small dead
 * zone around the centre stops a resting thumb from drifting, and pushing the
 * stick past the run ring makes the runner sprint.
 */
export function TouchControls({ game, snap }: { game: Game; snap: Snapshot }) {
  const knobRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef(false)
  /** where the thumb is pointing, 0..1 in each axis (clamped to the unit disc) */
  const targetRef = useRef({ x: 0, y: 0 })
  /** what the game is actually being fed, eased toward the target each frame */
  const curRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef(0)
  const lastRef = useRef(0)

  const readTarget = (clientX: number, clientY: number) => {
    const pad = padRef.current
    if (!pad) return
    const rect = pad.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const radius = rect.width / 2
    let dx = (clientX - cx) / radius
    let dy = (clientY - cy) / radius
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    targetRef.current = { x: dx, y: dy }
  }

  const frame = (now: number) => {
    const dt = lastRef.current ? Math.min(0.05, (now - lastRef.current) / 1000) : 0.016
    lastRef.current = now
    const cur = curRef.current
    const target = activeRef.current ? targetRef.current : { x: 0, y: 0 }
    // exponential ease: fast enough to feel connected, slow enough to soften
    // the jumps between coarse pointer events
    const k = Math.min(1, dt * 18)
    cur.x += (target.x - cur.x) * k
    cur.y += (target.y - cur.y) * k
    if (!activeRef.current && Math.hypot(cur.x, cur.y) < 0.01) {
      cur.x = 0
      cur.y = 0
    }

    // dead zone, then a gentle response curve so small pushes walk, not sprint
    const len = Math.hypot(cur.x, cur.y)
    let outX = 0
    let outY = 0
    if (len > 0.14) {
      const mag = Math.min(1, (len - 0.14) / 0.86)
      outX = (cur.x / len) * mag
      outY = (cur.y / len) * mag
    }
    game.setTouchAxis(outX, outY)
    game.setTouchRun(Math.hypot(outX, outY) > 0.82)

    if (knobRef.current) {
      const rect = padRef.current?.getBoundingClientRect()
      const radius = rect ? rect.width / 2 : 60
      knobRef.current.style.transform = `translate(${cur.x * (radius - 22)}px, ${cur.y * (radius - 22)}px)`
    }

    if (activeRef.current || Math.hypot(cur.x, cur.y) > 0.001) {
      rafRef.current = requestAnimationFrame(frame)
    } else {
      rafRef.current = 0
      lastRef.current = 0
    }
  }

  const startLoop = () => {
    if (!rafRef.current) {
      lastRef.current = 0
      rafRef.current = requestAnimationFrame(frame)
    }
  }

  const start = (e: React.PointerEvent) => {
    activeRef.current = true
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    readTarget(e.clientX, e.clientY)
    startLoop()
  }

  const move = (e: React.PointerEvent) => {
    if (!activeRef.current) return
    e.preventDefault()
    readTarget(e.clientX, e.clientY)
    startLoop()
  }

  const reset = () => {
    activeRef.current = false
    targetRef.current = { x: 0, y: 0 }
    startLoop()
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      game.setTouchAxis(0, 0)
      game.setTouchRun(false)
    }
  }, [game])

  const playing = snap.status === 'playing'

  // fire on pointerdown OR touchstart so rapid taps never get dropped
  const btn = (action: Parameters<Game['action']>[0], label: string) => ({
    type: 'button' as const,
    'aria-label': label,
    title: label,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      game.action(action)
    },
    onTouchStart: (e: React.TouchEvent) => e.preventDefault(),
  })

  return (
    <div className="touch">
      <div
        ref={padRef}
        className="joy-pad"
        style={{ display: playing ? 'block' : 'none' }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={reset}
        onPointerCancel={reset}
      >
        <div ref={knobRef} className="joy-knob" />
      </div>
      <div className="touch-btns" role="group" aria-label="Game controls" style={{ display: playing ? 'grid' : 'none' }}>
        <button className="touch-action touch-primary" {...btn('interact', 'Interact or talk')}><span aria-hidden="true">E</span><small>ACT</small></button>
        <button className="touch-action" {...btn('climb', 'Vault over an obstacle')}><span aria-hidden="true">↟</span><small>VAULT</small></button>
        <button className="touch-action" {...btn('hide', 'Hide or leave hiding')}><span aria-hidden="true">◉</span><small>HIDE</small></button>
        <button className="touch-action" {...btn('eat', 'Eat food')}><span aria-hidden="true">▰</span><small>EAT</small></button>
        <button className="touch-action" {...btn('drink', 'Drink water')}><span aria-hidden="true">◒</span><small>DRINK</small></button>
        <button className="touch-action" {...btn('sleep', 'Sleep near a bench')}><span aria-hidden="true">⌂</span><small>SLEEP</small></button>
      </div>
    </div>
  )
}
