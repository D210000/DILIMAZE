import { useState } from 'react'
import { CITIES_PER_REGION, REGIONS, regionIndexForCity } from '../game/city'
import type { Profile } from '../game/profile'
import { GlitchText } from './GlitchText'

interface WorldMapProps {
  profile: Profile
  onClose: () => void
  /** start a run at an already-reached city */
  onStartCity: (city: number) => void
}

export function WorldMap({ profile, onClose, onStartCity }: WorldMapProps) {
  const currentRegion = regionIndexForCity(profile.bestCity)
  const [openRegion, setOpenRegion] = useState(currentRegion)
  const region = REGIONS[openRegion]
  const loreUnlocked = profile.lore[region.id] === true

  const clearedInRegion = Math.max(0, Math.min(CITIES_PER_REGION, profile.bestCity - openRegion * CITIES_PER_REGION))

  return (
    <div className="screen map-screen">
      <div className="screen-inner wide">
        <div className="map-head">
          <div>
            <h1 className="map-title">THE ROUTE OUT</h1>
            <p className="tagline">
              5 regions · 100 cities · you are at City {profile.bestCity}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Back
          </button>
        </div>

        <div className="region-tabs">
          {REGIONS.map((r, i) => {
            const unlocked = i <= currentRegion
            const done = profile.lore[r.id] === true
            return (
              <button
                key={r.id}
                className={`region-tab${i === openRegion ? ' active' : ''}${unlocked ? '' : ' locked'}`}
                onClick={() => setOpenRegion(i)}
              >
                <span className="region-tab-name">{unlocked ? r.name : '??? ??? ???'}</span>
                <span className="region-tab-sub">
                  {done ? 'lore found' : `${Math.max(0, Math.min(CITIES_PER_REGION, profile.bestCity - i * CITIES_PER_REGION))}/${CITIES_PER_REGION}`}
                </span>
              </button>
            )
          })}
        </div>

        <div className="panel map-panel">
          <h2>{region.name}</h2>
          <p className="hint">{region.hook}</p>

          <div className="city-grid">
            {Array.from({ length: CITIES_PER_REGION }, (_, k) => {
              const city = openRegion * CITIES_PER_REGION + k + 1
              const reached = city <= profile.bestCity
              const isCurrent = city === profile.bestCity
              const isCleared = city < profile.bestCity
              return (
                <button
                  key={city}
                  className={`city-node${reached ? ' reached' : ' fogged'}${isCurrent ? ' current' : ''}${
                    isCleared ? ' cleared' : ''
                  }`}
                  disabled={!reached}
                  title={reached ? `City ${city}` : 'Not yet reached'}
                  onClick={() => onStartCity(city)}
                >
                  {reached ? city : ''}
                </button>
              )
            })}
          </div>

          <p className="hint">
            {clearedInRegion}/{CITIES_PER_REGION} cities cleared here. Tap any lit city to replay it. Fogged ones stay
            locked until you reach them.
          </p>

          <div className={`lore-box${loreUnlocked ? ' unlocked' : ''}`}>
            <span className="lore-label">REGION FILE</span>
            <GlitchText text={region.lore} locked={!loreUnlocked} />
          </div>
        </div>

        <div className="stat-strip">
          <span>Solves {profile.stats.solves}</span>
          <span>Deaths {profile.stats.deaths}</span>
          <span>Cities cleared {profile.stats.citiesCleared}</span>
          <span>Lore {Object.keys(profile.lore).length}/{REGIONS.length}</span>
        </div>
      </div>
    </div>
  )
}
