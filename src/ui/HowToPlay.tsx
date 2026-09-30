import { BRAND } from '../game/brand'

interface HowToPlayProps {
  onBack: () => void
}

const CONTROLS: Array<[string, string]> = [
  ['W A S D', 'Move'],
  ['Shift', 'Run'],
  ['E', 'Search, talk, use'],
  ['Space', 'Climb a wall or crate'],
  ['H', 'Hide'],
  ['F', 'Eat'],
  ['G', 'Drink'],
  ['T', 'Sleep on a bench'],
  ['Enter', 'Close a dialog'],
]

/** The manual. Short sections, in the order the game asks you to do them. */
export function HowToPlay({ onBack }: HowToPlayProps) {
  return (
    <div className="screen howto-screen">
      <div className="screen-inner">
        <div className="head-row">
          <h1 className="map-title">HOW TO PLAY</h1>
          <button className="ghost" onClick={onBack}>
            Back
          </button>
        </div>

        <div className="panel howto-panel">
          <section className="howto-block">
            <h3>The goal</h3>
            <p>
              Smuggle one runner across the whole country, from City 1 to City 100, and walk out the far side free.
              The route runs through 5 regions of 20 cities. Clear every city to win.
            </p>
          </section>

          <section className="howto-block">
            <h3>Every city works the same way</h3>
            <ol className="howto-list">
              <li>
                <strong>Follow the clue trail.</strong> Each city hides a few clues on marked props. Walk up and press E
                to search one.
              </li>
              <li>
                <strong>Read the riddle.</strong> Every clue hands you a riddle that points at the next one. The line
                under it names the sort of place to look, and the SIGNAL meter warms up as you close in. In the first
                cities a tracker arrow points the way.
              </li>
              <li>
                <strong>Crack the signal lock.</strong> A sealed clue opens a small puzzle. Wrong answers cost nothing:
                after three tries the panel starts coaching and after five it hands over the answer.
              </li>
              <li>
                <strong>Take the border pass.</strong> Find every clue in the city and the pass is granted.
              </li>
              <li>
                <strong>Run east.</strong> With the pass in hand, walk off the east edge of the map through the gate.
                That city is cleared and the next one opens.
              </li>
            </ol>
          </section>

          <section className="howto-block">
            <h3>Staying alive</h3>
            <p>
              Hunger, Thirst and Health drain as you play. Eat with F, drink with G, and pick up bread, water and $DLI
              as you cross the city. At zero hunger or thirst you start losing health, and at zero health the city
              restarts. Sleep on a bench or in any safe corner with T to jump forward to the next morning.
            </p>
          </section>

          <section className="howto-block">
            <h3>Guards</h3>
            <p>
              Guards walk fixed routes and watch a vision cone. If they reach you they search you, take coins and food,
              and send you back to the spawn. Hide with H in a bush or a crate to break their line of sight, and climb
              with Space to cut across rooftops and walls. In deep night their cone is shorter but wider, and they move
              faster.
            </p>
            <p>
              Every region fields a heavier patrol than the one before, and you can see it: a Fringe patrol is a light
              figure with a short stare, and a Lockdown enforcer is plated, lit and quick. There are five ranks, patrol,
              sentry, warden, marshal and enforcer, and every third guard on a route is a captain, a rank above its
              city with gold on the helmet and the shoulders.
            </p>
          </section>

          <section className="howto-block">
            <h3>Light and time</h3>
            <p>
              Every city day opens in bright morning sun and darkens while you play until the streets are deep night. A
              day runs for a couple of minutes. Staying out all night costs health unless you sleep, so a bench is
              always worth knowing about.
            </p>
          </section>

          <section className="howto-block">
            <h3>Progress and ranking</h3>
            <p>
              Your save lives on this device only. There is no account and no server. Every city you clear is timed, so
              Ranking lists your fastest clear of each level as well as your best full run from City 1 to City 100.
            </p>
          </section>

          <section className="howto-block">
            <h3>Controls</h3>
            <div className="howto-keys">
              {CONTROLS.map(([key, what]) => (
                <div key={key} className="howto-key">
                  <kbd>{key}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </div>
            <p className="hint">
              On a phone or tablet, use the on screen stick to move and the action buttons along the bottom. {BRAND.game}{' '}
              {BRAND.gameLine2} works offline once loaded.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
