import { useState } from 'react'
import { CITIES_PER_REGION, REGIONS } from '../game/city'
import type { Profile } from '../game/profile'
import { fmtClock, loadRecords } from '../game/records'

interface RankingProps {
  profile: Profile
  onBack: () => void
}

function fmtDay(at: number): string {
  if (!at) return ''
  try {
    return new Date(at).toLocaleDateString()
  } catch {
    return ''
  }
}

/**
 * The ranking board. Every city clear is timed by the engine; this screen shows
 * the fastest clear of each level plus the completed full runs, fastest first.
 * The board is per device: there is no server to send a time to.
 */
export function Ranking({ profile, onBack }: RankingProps) {
  const [records] = useState(() => loadRecords())

  const timed = Object.keys(records.cities)
    .map((k) => ({ city: Number(k), seconds: records.cities[k] }))
    .sort((a, b) => a.city - b.city)
  const sum = timed.reduce((acc, t) => acc + t.seconds, 0)
  const fastest = timed.reduce<{ city: number; seconds: number } | null>(
    (best, t) => (!best || t.seconds < best.seconds ? t : best),
    null,
  )
  const bestRun = records.runs[0]

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="head-row">
          <h1 className="map-title">RANKING</h1>
          <button className="ghost" onClick={onBack}>
            Back
          </button>
        </div>

        <div className="panel">
          <p className="hint">
            Times for {profile.name}. They are stored on this device, so this board is yours alone.
          </p>

          <div className="stat-grid">
            <div>
              <span>Levels timed</span>
              <strong>
                {timed.length}/{CITIES_PER_REGION * REGIONS.length}
              </strong>
            </div>
            <div>
              <span>Fastest clear</span>
              <strong>{fastest ? fmtClock(fastest.seconds) : 'none yet'}</strong>
            </div>
            <div>
              <span>Sum of best</span>
              <strong>{timed.length ? fmtClock(sum) : 'none yet'}</strong>
            </div>
            <div>
              <span>Best full run</span>
              <strong>{bestRun ? fmtClock(bestRun.seconds) : 'none yet'}</strong>
            </div>
          </div>

          {timed.length === 0 ? (
            <p className="rank-empty">
              No times yet. Every city you clear is timed, so your first record lands here the moment you cross a gate.
            </p>
          ) : (
            <>
              {fastest && (
                <p className="rank-flash">
                  Quickest clear so far: City {fastest.city} in {fmtClock(fastest.seconds)}
                </p>
              )}

              {records.runs.length > 0 && (
                <section className="rank-block">
                  <h3>Full runs</h3>
                  <div className="rank-rows">
                    {records.runs.slice(0, 5).map((r, i) => (
                      <div key={`${r.at}-${i}`} className="rank-row">
                        <span className="rank-pos">{i + 1}</span>
                        <span className="rank-what">City 1 to City 100</span>
                        <span className="rank-time">{fmtClock(r.seconds)}</span>
                        <span className="rank-when">{fmtDay(r.at)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="rank-block">
                <h3>Fastest clear per level</h3>
                {REGIONS.map((region, ri) => {
                  const rows = timed.filter(
                    (t) => t.city > ri * CITIES_PER_REGION && t.city <= (ri + 1) * CITIES_PER_REGION,
                  )
                  if (rows.length === 0) return null
                  const regionSum = rows.reduce((acc, t) => acc + t.seconds, 0)
                  return (
                    <div key={region.id} className="rank-region">
                      <div className="rank-region-head">
                        <span className="rank-region-name">{region.name}</span>
                        <span className="rank-region-sum">
                          {rows.length}/{CITIES_PER_REGION} timed · {fmtClock(regionSum)}
                        </span>
                      </div>
                      <div className="rank-rows">
                        {rows.map((t) => (
                          <div key={t.city} className="rank-row">
                            <span className="rank-pos">{t.city}</span>
                            <span className="rank-what">City {t.city}</span>
                            <span className="rank-time">{fmtClock(t.seconds)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
