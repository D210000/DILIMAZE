import { useState } from 'react'
import { SKINS } from '../game/brand'
import type { CameraMode, LookMode, Profile } from '../game/profile'
import { SkinPicker } from './Onboarding'

interface SettingsProps {
  profile: Profile
  storageOk: boolean
  /** rename the runner (applies immediately, sanitized by the save layer) */
  onRename: (name: string) => void
  /** switch avatar skin */
  onChangeSkin: (skin: string) => void
  /** pick the camera the run opens with */
  onChangeCamera: (camera: CameraMode) => void
  /** pick how the mouse turns the street camera */
  onChangeLook: (look: LookMode) => void
  /** reopen the first time tour, for a player who wants it again */
  onReplayTutorial: () => void
  onReset: () => void
  onBack: () => void
}

/**
 * Settings: the two things a player can change about themselves, the avatar and
 * the display name, plus the one destructive action on the whole save.
 *
 * The skin applies the moment it is tapped (the preview is the confirmation).
 * The name needs an explicit Save so a half typed word never lands in the save,
 * which is also what keeps the integrity fingerprint stable.
 */
export function Settings({
  profile,
  storageOk,
  onRename,
  onChangeSkin,
  onChangeCamera,
  onChangeLook,
  onReplayTutorial,
  onReset,
  onBack,
}: SettingsProps) {
  const [name, setName] = useState(profile.name)
  const [confirmReset, setConfirmReset] = useState(false)
  const skinDef = SKINS.find((s) => s.id === profile.skin) ?? SKINS[0]
  const trimmed = name.trim()
  const dirty = trimmed.length > 0 && trimmed !== profile.name

  const save = () => {
    if (!trimmed || trimmed === profile.name) return
    onRename(trimmed)
    setName(trimmed)
  }

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="head-row">
          <h1 className="map-title">SETTINGS</h1>
          <button className="ghost" onClick={onBack}>
            Back
          </button>
        </div>

        <div className="panel settings-panel">
          <h2>Runner name</h2>
          <label className="field-label" htmlFor="settings-name">
            Display name
          </label>
          <input
            id="settings-name"
            value={name}
            maxLength={14}
            placeholder="Runner"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
          <p className="hint">Shown on the HUD and in your records. Up to 14 characters.</p>
          <button className="primary" disabled={!dirty} onClick={save}>
            {dirty ? 'Save name' : 'Name saved'}
          </button>

          <h2>Character</h2>
          <SkinPicker value={profile.skin} onChange={onChangeSkin} />
          <p className="hint skin-blurb">{skinDef.blurb}</p>

          <h2>Camera</h2>
          <p className="hint">
            The map view looks down on the whole block. The street camera drops to eye level and walks the city with
            you. You can also flip between them mid run from the button in the top corner.
          </p>
          <div className="cam-picker">
            <button
              className={profile.settings.camera === 'top' ? 'cam-option active' : 'cam-option'}
              onClick={() => onChangeCamera('top')}
            >
              <strong>Map view</strong>
              <span>See the whole street from above</span>
            </button>
            <button
              className={profile.settings.camera === 'walk' ? 'cam-option active' : 'cam-option'}
              onClick={() => onChangeCamera('walk')}
            >
              <strong>Street view</strong>
              <span>Walk the pavement at eye level</span>
            </button>
          </div>

          <h2>Mouse look</h2>
          <p className="hint">
            How the mouse turns the street camera. A phone always looks by dragging with a finger.
          </p>
          <div className="cam-picker three">
            <button
              className={profile.settings.look === 'drag' ? 'cam-option active' : 'cam-option'}
              onClick={() => onChangeLook('drag')}
            >
              <strong>Right button drag</strong>
              <span>Hold the right button and sweep to look around</span>
            </button>
            <button
              className={profile.settings.look === 'free' ? 'cam-option active' : 'cam-option'}
              onClick={() => onChangeLook('free')}
            >
              <strong>Free look</strong>
              <span>Click the street once to take the mouse, then look by moving it. Escape lets go</span>
            </button>
            <button
              className={profile.settings.look === 'off' ? 'cam-option active' : 'cam-option'}
              onClick={() => onChangeLook('off')}
            >
              <strong>Mouse off</strong>
              <span>The mouse never moves the view</span>
            </button>
          </div>

          <h2>How to play</h2>
          <p className="hint">
            Reopen the quick tour that runs before a player's first city. It covers movement, clues, puzzles, the border
            pass, your three bars and the guards.
          </p>
          <button className="ghost" onClick={onReplayTutorial}>
            Watch the tour again
          </button>

          <div className="danger-row">
            {!confirmReset ? (
              <button className="ghost" onClick={() => setConfirmReset(true)}>
                Reset profile
              </button>
            ) : (
              <>
                <p className="hint">
                  Erase all progress, stats, lore and ranking times on this device? This cannot be undone.
                </p>
                <div className="menu-buttons">
                  <button className="danger" onClick={onReset}>
                    Yes, wipe it
                  </button>
                  <button className="ghost" onClick={() => setConfirmReset(false)}>
                    Keep my save
                  </button>
                </div>
              </>
            )}
          </div>

          {!storageOk && <p className="hint warn-line">Local storage is blocked. Changes will not persist.</p>}
        </div>
      </div>
    </div>
  )
}
