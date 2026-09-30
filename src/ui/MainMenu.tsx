import { useState } from 'react'
import { BRAND } from '../game/brand'
import { REGIONS, regionIndexForCity } from '../game/city'
import type { Profile } from '../game/profile'
import { fmtClock, loadRecords } from '../game/records'
import { SkinPreview } from './Onboarding'

interface MainMenuProps {
  profile: Profile
  storageOk: boolean
  /** true the first time the menu is shown, right after the runner was created */
  fresh: boolean
  /** resume the run in progress (falls back to the last reached city) */
  onPlay: () => void
  /** wipe the resumable run and start again at City 1 */
  onNewRun: () => void
  onOpenMap: () => void
  onSettings: () => void
  onHowToPlay: () => void
  onRanking: () => void
}

/**
 * The hub every session lands on, both right after the runner is created and
 * when a player comes back to a save. It is deliberately the same screen for
 * both cases: the only thing that changes is whether the big button says Play
 * or Continue, and whether Start new run is offered.
 */
export function MainMenu({
  profile,
  storageOk,
  fresh,
  onPlay,
  onNewRun,
  onOpenMap,
  onSettings,
  onHowToPlay,
  onRanking,
}: MainMenuProps) {
  // read once per mount: this screen is remounted every time it is shown, so the
  // board is always fresh when the player returns from a run
  const [records] = useState(() => loadRecords())

  const region = REGIONS[regionIndexForCity(profile.bestCity)]
  const run = profile.run
  const timedCities = Object.keys(records.cities).length
  const bestRun = records.runs[0]

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="brand-strip">
          <span className="brand-mark">{BRAND.game} {BRAND.gameLine2}</span>
        </div>

        <h1 className="welcome-title">
          {fresh ? 'Ready, ' : 'Welcome back, '}
          <span className="neon-name">{profile.name}</span>
        </h1>
        <p className="tagline">
          {run
            ? `Paused on Day ${run.day} in City ${run.city} of 100`
            : `City ${profile.bestCity} of 100 in ${region.name}`}
        </p>

        <div className="panel menu-panel">
          <div className="menu-stack">
            <button className="primary wide" onClick={onPlay}>
              {run ? 'Continue' : 'Play'}
            </button>
            {run && (
              <button className="wide" onClick={onNewRun}>
                Start new run
              </button>
            )}
          </div>

          <div className="menu-grid">
            <button onClick={onSettings}>Settings</button>
            <button onClick={onHowToPlay}>How to play?</button>
            <button onClick={onRanking}>Ranking</button>
          </div>

          <div className="menu-side">
            <button className="ghost" onClick={onOpenMap}>
              World map
            </button>
          </div>

          <div className="menu-id">
            <SkinPreview skinId={profile.skin} size={54} />
            <div className="menu-id-stats">
              <span>
                Best city <strong>{profile.bestCity}/100</strong>
              </span>
              <span>
                Cities cleared <strong>{profile.stats.citiesCleared}</strong>
              </span>
              <span>
                Levels timed <strong>{timedCities}/100</strong>
              </span>
              {bestRun && (
                <span>
                  Best full run <strong>{fmtClock(bestRun.seconds)}</strong>
                </span>
              )}
            </div>
          </div>

          {run && (
            <p className="hint">
              Where you left off: hunger {Math.round(run.hunger)}% · thirst {Math.round(run.thirst)}% · {run.coins}{' '}
              $DLI
            </p>
          )}

          {!storageOk && <p className="hint warn-line">Local storage is blocked. This session will not be saved.</p>}
        </div>

        <p className="controls-hint">WASD move · Shift run · E interact · Space climb · H hide · F eat · G drink · T sleep</p>
      </div>
    </div>
  )
}
