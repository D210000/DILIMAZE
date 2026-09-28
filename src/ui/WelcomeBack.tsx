import { useState } from 'react'
import { BRAND } from '../game/brand'
import { REGIONS, regionIndexForCity } from '../game/city'
import type { Profile } from '../game/profile'
import { SkinPicker } from './Onboarding'

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

interface WelcomeBackProps {
  profile: Profile
  onContinue: () => void
  onOpenMap: () => void
  onNewRun: () => void
  onReset: () => void
  onChangeSkin: (skin: string) => void
  storageOk: boolean
}

export function WelcomeBack({
  profile,
  onContinue,
  onOpenMap,
  onNewRun,
  onReset,
  onChangeSkin,
  storageOk,
}: WelcomeBackProps) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [editingSkin, setEditingSkin] = useState(false)
  const region = REGIONS[regionIndexForCity(profile.bestCity)]
  const run = profile.run

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="brand-strip">
          <span className="brand-mark">{BRAND.game} {BRAND.gameLine2}</span>
        </div>

        <h1 className="welcome-title">
          Welcome back, <span className="neon-name">{profile.name}</span>
        </h1>
        <p className="tagline">
          Resume at City {profile.bestCity} of 100 in {region.name}
        </p>

        <div className="panel">
          <div className="stat-grid">
            <div>
              <span>Best city</span>
              <strong>{profile.bestCity}/100</strong>
            </div>
            <div>
              <span>Cities cleared</span>
              <strong>{profile.stats.citiesCleared}</strong>
            </div>
            <div>
              <span>Clues solved</span>
              <strong>{profile.stats.solves}</strong>
            </div>
            <div>
              <span>Deaths</span>
              <strong>{profile.stats.deaths}</strong>
            </div>
            <div>
              <span>Attempts</span>
              <strong>{profile.stats.attempts}</strong>
            </div>
            <div>
              <span>Time played</span>
              <strong>{fmtTime(profile.stats.timePlayedSec)}</strong>
            </div>
          </div>

          {run && (
            <p className="hint">
              Where you left off: Day {run.day} in City {run.city} · hunger {Math.round(run.hunger)}% · thirst{' '}
              {Math.round(run.thirst)}% · {run.coins} $DLI
            </p>
          )}

          <div className="menu-buttons">
            <button className="primary" onClick={onContinue}>
              Continue
            </button>
            <button onClick={onOpenMap}>World map</button>
            <button onClick={onNewRun}>Restart current city</button>
            <button onClick={() => setEditingSkin((v) => !v)}>{editingSkin ? 'Done' : 'Change avatar'}</button>
          </div>

          {editingSkin && <SkinPicker value={profile.skin} onChange={onChangeSkin} />}

          {!confirmReset ? (
            <button className="ghost" onClick={() => setConfirmReset(true)}>
              Reset profile
            </button>
          ) : (
            <div className="danger-row">
              <p className="hint">Erase all progress, stats and lore on this device?</p>
              <button className="danger" onClick={onReset}>
                Yes, wipe it
              </button>
              <button className="ghost" onClick={() => setConfirmReset(false)}>
                Keep my run
              </button>
            </div>
          )}

          {!storageOk && <p className="hint warn-line">Local storage is blocked. This session will not be saved.</p>}
        </div>
      </div>
    </div>
  )
}
