import { useCallback, useEffect, useRef, useState } from 'react'
import { BRAND } from './game/brand'
import { Game } from './game/engine'
import {
  freshProfile,
  loadProfile,
  resetProfile,
  saveProfile,
  storageAvailable,
  type CameraMode,
  type LookMode,
  type Profile,
} from './game/profile'
import { clearRecords } from './game/records'
import { render } from './game/render'
import { sfx } from './game/sound'
import { HowToPlay } from './ui/HowToPlay'
import { HUD } from './ui/HUD'
import { MainMenu } from './ui/MainMenu'
import { Menus } from './ui/Menus'
import { Onboarding } from './ui/Onboarding'
import { Ranking } from './ui/Ranking'
import { Settings } from './ui/Settings'
import { TouchControls } from './ui/TouchControls'
import { Tutorial } from './ui/Tutorial'
import { WorldMap } from './ui/WorldMap'

type Screen = 'booting' | 'onboarding' | 'menu' | 'settings' | 'howto' | 'ranking' | 'map' | 'game' | 'tutorial'

/** what to do once the tutorial finishes: start this run, or go back to a menu */
interface TutorialIntent {
  launch: { city: number; fresh: boolean } | null
}

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
  /** set while the first time tour is up, holding the run it should hand over to */
  const [tut, setTut] = useState<TutorialIntent | null>(null)

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

  /* ---------------- look controls (street camera) ---------------- */

  /**
   * How the street view looks around, driven by one setting on the profile:
   *  - `drag` (the default): a mouse holds the LEFT button and sweeps to turn.
   *    Nothing happens on a plain hover, so moving the cursor toward a chip, or
   *    leaving it parked by an edge, can never take the camera with it;
   *  - `free`: the view follows every mouse move with no button at all, and a
   *    right click on the canvas takes the cursor with pointer lock so it cannot leave
   *    the window mid turn. Escape hands the pointer back for the buttons on
   *    screen, and a browser that refuses the lock still gets the mouse look;
   *  - `off`: the mouse is left alone entirely.
   * A finger drags to look whatever the setting says, because a phone has no
   * mouse button; the stick lives on its own element, so a thumb on it and a
   * finger turning the view work at the same time. Every path feeds the same
   * smoothed aim on the engine, so the turn is eased rather than snapped, and
   * the map view has no heading and ignores all of it.
   */
  useEffect(() => {
    if (!ENGINE_READY) return
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false
    let lastX = 0
    let lastY = 0

    const locked = () => document.pointerLockElement === canvas

    const down = (e: PointerEvent) => {
      const g = gameRef.current
      if (!g || g.cameraMode !== 'walk' || g.status !== 'playing') return
      if (e.pointerType === 'mouse') {
        if (g.lookMode === 'free') {
          // free look needs the cursor, and a right click is the gesture that asks for
          // it: from here on every move turns the view, no button to hold
          if (e.button !== 2) return
          e.preventDefault()
          if (!locked()) void canvas.requestPointerLock?.()
          return
        }
        // the left button drag is the default; anything else is the page's
        if (g.lookMode !== 'drag' || e.button !== 0) return
      }
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      // do not let a browser context menu interrupt street camera use
      e.preventDefault()
      canvas.setPointerCapture?.(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const g = gameRef.current
      if (!g || g.cameraMode !== 'walk') return
      if (e.pointerType === 'mouse') {
        // Free look follows every mouse move. The pointer lock is the reason the
        // cursor cannot escape the window while you turn, not the reason the
        // turning works: a browser that refuses the lock still gets mouse look,
        // and events only reach here while the cursor is over the street rather
        // than over a button on the HUD.
        if (g.lookMode === 'free') {
          if (e.movementX !== 0 || e.movementY !== 0) {
            g.look(e.movementX, e.movementY)
            if (locked()) e.preventDefault()
          }
          return
        }
        if (g.lookMode !== 'drag') return
      }
      if (!dragging) return
      // the button can be let go outside the window; a mouse with nothing held is
      // not a drag, whatever the last event happened to say
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        dragging = false
        return
      }
      g.look(e.clientX - lastX, e.clientY - lastY)
      lastX = e.clientX
      lastY = e.clientY
      e.preventDefault()
    }
    const up = (e: PointerEvent) => {
      dragging = false
      canvas.releasePointerCapture?.(e.pointerId)
    }
    /** the context menu belongs to the page, not to a camera drag */
    const menu = (e: Event) => {
      const g = gameRef.current
      if (g && g.cameraMode === 'walk' && g.lookMode !== 'off') e.preventDefault()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('contextmenu', menu)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('contextmenu', menu)
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
      // Browsers repeat keydown while a key is held. Actions are taps, so one
      // press should never eat several items or queue repeated interactions.
      if (e.repeat && ['KeyE', 'Space', 'KeyH', 'KeyF', 'KeyG', 'KeyT'].includes(e.code)) {
        e.preventDefault()
        return
      }
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
    // A key-up can be lost when the app is backgrounded or focus moves to
    // browser chrome. Clear every movement key so a returning player never
    // finds the runner walking on its own.
    const releaseAll = () => {
      const g = gameRef.current
      if (!g) return
      for (const code of [
        'KeyW', 'KeyA', 'KeyS', 'KeyD',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'ShiftLeft', 'ShiftRight',
      ]) g.setKey(code, false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', releaseAll)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', releaseAll)
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
      // the low background bed runs for as long as a run is open
      sfx.startAmbient()
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

  /**
   * Play. A player who has never seen the tour gets it first, once, before their
   * run starts; everyone else goes straight in. Replayable from Settings and the
   * manual, where it closes back to the menu instead of launching anything.
   */
  const startRun = useCallback(
    (city: number, fresh = false) => {
      const prof = profileRef.current
      if (prof && prof.tutorialSeen !== true) {
        setTut({ launch: { city, fresh } })
        setScreen('tutorial')
        return
      }
      launch(city, fresh)
    },
    [launch],
  )

  const finishTutorial = useCallback(() => {
    const prof = profileRef.current
    if (prof && prof.tutorialSeen !== true) persist({ tutorialSeen: true })
    const target = tut?.launch ?? null
    setTut(null)
    if (target) launch(target.city, target.fresh)
    else setScreen('menu')
  }, [launch, persist, tut])

  /**
   * Camera choice: remembered on the profile and pushed into a live game so the
   * swap is instant. Works from the settings menu (no game open) and from the
   * in run chip alike.
   */
  const setCamera = useCallback((camera: CameraMode) => {
    const live = profileRef.current
    if (live) {
      live.settings.camera = camera
      saveProfile(live)
      setProfile({ ...live })
    }
    gameRef.current?.setCameraMode(camera)
    // the map view has no heading, so a held cursor is just a hidden pointer
    if (camera !== 'walk' && document.pointerLockElement) document.exitPointerLock?.()
  }, [])

  const setLook = useCallback((look: LookMode) => {
    const live = profileRef.current
    if (live) {
      live.settings.look = look
      saveProfile(live)
      setProfile({ ...live })
    }
    gameRef.current?.setLookMode(look)
    // turning free look off should hand the cursor straight back
    if (look !== 'free' && document.pointerLockElement) document.exitPointerLock?.()
  }, [])

  const backToMenu = useCallback(() => {
    gameRef.current?.saveNow()
    sfx.stopAmbient()
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
          <div className="top-chips">
            <button className="exit-chip" onClick={backToMenu} title="Save and return to menu">
              ⌂ menu
            </button>
            <button
              className="camera-chip"
              onClick={() => setCamera(g.cameraMode === 'walk' ? 'top' : 'walk')}
              title="Switch between the map view and the street camera"
            >
              {g.cameraMode === 'walk' ? '3D street' : '2D map'}
            </button>
          </div>
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
              // keep the career, just rename / reskin (including whether this
              // runner has already been through the first time tour)
              p.bestCity = existing.bestCity
              p.stats = existing.stats
              p.lore = existing.lore
              p.createdAt = existing.createdAt
              p.tutorialSeen = existing.tutorialSeen === true
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
          onPlay={() => startRun(profile.run?.city ?? profile.bestCity, false)}
          onNewRun={() => startRun(1, true)}
          onOpenMap={() => setScreen('map')}
          onSettings={() => setScreen('settings')}
          onHowToPlay={() => setScreen('howto')}
          onRanking={() => setScreen('ranking')}
          onChangeCamera={setCamera}
        />
      )}

      {screen === 'tutorial' && tut && <Tutorial replay={tut.launch === null} onDone={finishTutorial} />}

      {screen === 'settings' && profile && (
        <Settings
          profile={profile}
          storageOk={storageOk}
          onRename={(name) => persist({ name })}
          onChangeSkin={(skin) => persist({ skin })}
          onChangeCamera={setCamera}
          onChangeLook={setLook}
          onReplayTutorial={() => {
            setTut({ launch: null })
            setScreen('tutorial')
          }}
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

      {screen === 'howto' && (
        <HowToPlay
          onBack={() => setScreen('menu')}
          onTutorial={() => {
            setTut({ launch: null })
            setScreen('tutorial')
          }}
        />
      )}

      {screen === 'ranking' && profile && <Ranking profile={profile} onBack={() => setScreen('menu')} />}

      {screen === 'map' && profile && (
        <WorldMap
          profile={profile}
          onClose={() => setScreen('menu')}
          onStartCity={(city) => startRun(city, false)}
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
