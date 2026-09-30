import { useCallback, useEffect, useRef, useState } from 'react'
import { BRAND } from './game/brand'
import { Game } from './game/engine'
import { freshProfile, loadProfile, resetProfile, saveProfile, storageAvailable, type Profile } from './game/profile'
import { clearRecords } from './game/records'
import { render } from './game/render'
import { HowToPlay } from './ui/HowToPlay'
import { HUD } from './ui/HUD'
import { MainMenu } from './ui/MainMenu'
import { Menus } from './ui/Menus'
import { Onboarding } from './ui/Onboarding'
import { Ranking } from './ui/Ranking'
import { Settings } from './ui/Settings'
import { TouchControls } from './ui/TouchControls'
import { WorldMap } from './ui/WorldMap'

type Screen = 'booting' | 'onboarding' | 'menu' | 'settings' | 'howto' | 'ranking' | 'map' | 'game'

const ENGINE_READY = typeof window !== 'undefined'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  /** the single live profile object — the engine mutates this same instance */
  const profileRef = useRef<Profile | null>(null)
  const [, setTick] = useState(0)
  const [screen, setScreen] = useState<Screen>('booting')
  /** true when the menu is reached straight from creating a runner this session */
  const [freshRunner, setFreshRunner] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  /** the save is read exactly once, at mount */
  const [boot] = useState(() => (ENGINE_READY ? loadProfile() : null))
  const [recovered] = useState(() => boot?.corruptRecovered === true)
  const [tampered] = useState(() => boot?.tamperRecovered === true)
  const [storageOk] = useState(() => (ENGINE_READY ? storageAvailable() : false))

  /* ---------------- boot: load or start a profile ---------------- */

  useEffect(() => {
    if (!ENGINE_READY) return
    profileRef.current = boot
    setProfile(boot ? { ...boot } : null)
    setScreen(boot?.onboarded ? 'menu' : 'onboarding')
  }, [boot])

  /* ---------------- dev-only tooling ---------------- */

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let cancelled = false
    // the self-test module is only ever fetched by a dev build, so it is
    // tree-shaken out of the shipped bundle along with the console handle
    import('./devtools/selftest')
      .then((m) => {
        if (!cancelled) (window as unknown as { __dilimaze?: unknown }).__dilimaze = m
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  /** mutate the live profile, persist it, and refresh the UI copy */
  const persist = useCallback((patch: Partial<Profile>) => {
    const live = profileRef.current
    if (!live) return
    Object.assign(live, patch)
    saveProfile(live)
    setProfile({ ...live })
  }, [])

  /* ---------------- canvas + render loop ---------------- */

  useEffect(() => {
    if (!ENGINE_READY) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      // render at device resolution for crisp pixels on phone screens
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)

    let raf = 0
    const loop = () => {
      const g = gameRef.current
      if (g) {
        // render in CSS pixels; backing store is device-scaled for sharpness
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        render(ctx, g, canvas.clientWidth, canvas.clientHeight)
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    if (!ENGINE_READY) return
    const isTypingTarget = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      if (!g) return
      // Let the player type freely in puzzle/dialog inputs — never hijack WASD there
      if (isTypingTarget(e.target)) return
      // While an overlay is up, don't move the stickman or queue actions
      if (g.status !== 'playing') {
        if (e.code === 'Enter' && g.status === 'dialog') g.closeDialog()
        return
      }
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)
      )
        e.preventDefault()
      if (e.code === 'KeyE') g.action('interact')
      else if (e.code === 'Space') g.action('climb')
      else if (e.code === 'KeyH') g.action('hide')
      else if (e.code === 'KeyF') g.action('eat')
      else if (e.code === 'KeyG') g.action('drink')
      else if (e.code === 'KeyT') g.action('sleep')
      else g.setKey(e.code, true)
    }
    const up = (e: KeyboardEvent) => {
      gameRef.current?.setKey(e.code, false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  /* ---------------- engine <-> UI plumbing ---------------- */

  const unsubscribe = useRef<(() => void) | null>(null)

  const mountGame = useCallback(
    (g: Game) => {
      unsubscribe.current?.()
      // Dev builds expose the engine for the console and preview tooling. A
      // production build deliberately has NO global that can hand out a pass,
      // grant clues or edit the run — see the audit notes in the README.
      if (import.meta.env.DEV) (window as unknown as { game?: Game }).game = g
      gameRef.current = g
      g.start()
      unsubscribe.current = g.subscribe(() => setTick((t) => t + 1))
      setTick((t) => t + 1)
    },
    [],
  )

  const launch = useCallback(
    (city: number, fresh = false) => {
      const prof = profileRef.current
      if (!prof) return
      const target = Math.max(1, Math.min(100, Math.round(city)))
      const resume = !fresh && prof.run && prof.run.city === target ? prof.run : null
      const g = new Game(target, prof.stats.deaths, 0, { skinId: prof.skin, profile: prof, resume })
      mountGame(g)
      // the greet is a one time thing: from here on the menu says welcome back
      setFreshRunner(false)
      setScreen('game')
    },
    [mountGame],
  )

  const backToMenu = useCallback(() => {
    gameRef.current?.saveNow()
    unsubscribe.current?.()
    unsubscribe.current = null
    gameRef.current = null
    const live = profileRef.current
    setProfile(live ? { ...live } : null)
    setScreen('menu')
  }, [])

  const snap = gameRef.current?.getSnapshot()
  const g = gameRef.current

  /* ---------------- screens ---------------- */

  return (
    <div className="app">
      {/* canvas stays mounted so the render loop is never torn down */}
      <canvas ref={canvasRef} className={`game-canvas${screen === 'game' ? '' : ' idle'}`} />

      {screen === 'game' && g && snap && (
        <>
          <HUD snap={snap} />
          <TouchControls game={g} snap={snap} />
          <Menus snap={snap} gameRef={gameRef} onNew={() => launch(1, true)} />
          <button className="exit-chip" onClick={backToMenu} title="Save and return to menu">
            ⌂ menu
          </button>
        </>
      )}

      {screen === 'onboarding' && (
        <Onboarding
          recovered={recovered}
          tampered={tampered}
          storageOk={storageOk}
          initialSkin={profile?.skin}
          onStart={(name, skin) => {
            const existing = profileRef.current
            const p = freshProfile(name, skin)
            p.onboarded = true
            p.run = null
            if (existing) {
              // keep the career, just rename / reskin
              p.bestCity = existing.bestCity
              p.stats = existing.stats
              p.lore = existing.lore
              p.createdAt = existing.createdAt
            }
            profileRef.current = p
            persist({})
            // the runner is created, but the run itself now starts from the menu
            setFreshRunner(true)
            setScreen('menu')
          }}
        />
      )}

      {screen === 'menu' && profile && (
        <MainMenu
          profile={profile}
          storageOk={storageOk}
          fresh={freshRunner}
          onPlay={() => launch(profile.run?.city ?? profile.bestCity, false)}
          onNewRun={() => launch(1, true)}
          onOpenMap={() => setScreen('map')}
          onSettings={() => setScreen('settings')}
          onHowToPlay={() => setScreen('howto')}
          onRanking={() => setScreen('ranking')}
        />
      )}

      {screen === 'settings' && profile && (
        <Settings
          profile={profile}
          storageOk={storageOk}
          onRename={(name) => persist({ name })}
          onChangeSkin={(skin) => persist({ skin })}
          onBack={() => setScreen('menu')}
          onReset={() => {
            resetProfile()
            clearRecords()
            profileRef.current = null
            setProfile(null)
            setFreshRunner(false)
            setScreen('onboarding')
          }}
        />
      )}

      {screen === 'howto' && <HowToPlay onBack={() => setScreen('menu')} />}

      {screen === 'ranking' && profile && <Ranking profile={profile} onBack={() => setScreen('menu')} />}

      {screen === 'map' && profile && (
        <WorldMap
          profile={profile}
          onClose={() => setScreen('menu')}
          onStartCity={(city) => launch(city, false)}
        />
      )}

      {screen === 'booting' && (
        <div className="screen">
          <div className="screen-inner">
            <h1 className="game-title">{BRAND.game}</h1>
            <p className="tagline">loading the grid…</p>
          </div>
        </div>
      )}

      {screen !== 'game' && (
        <div className="ambient" aria-hidden="true">
          <span className="ambient-glow one" />
          <span className="ambient-glow two" />
        </div>
      )}
    </div>
  )
}
