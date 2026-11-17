import type { EffectType } from '../../../core/motion'
import { settingsLine } from '../../../core/motion'
import { MOVEMENT_WORDS, effectsCount, patchNoTake } from '../../motionText'
import type { MotionState } from '../../api/images'
import { off } from '../../off'

/** A patch of the image as the controls list it: its title and where its chosen take's picture is, if it has one. */
export interface MovementPatch {
  id: string
  title: string
  src: string | null
}

/** What the Patches and Effects groups show and change, the same in the side column and in full screen. */
export interface MotionControlsProps {
  /** The patches in the game's order; null while the patches are not known, which leaves the group out. */
  patches: MovementPatch[] | null
  patchesOn: ReadonlySet<string>
  onPatch: (id: string, on: boolean) => void
  motion: MotionState
  effectsOn: ReadonlySet<string>
  onEffect: (type: string, on: boolean) => void
  /** Whether there is a picture for anything to move over; the switches wait for one. */
  hasPicture: boolean
}

/** One switch with its label, which cannot be changed while it has a `why`. */
function Switch({
  label,
  checked,
  why,
  onChange,
}: {
  label: string
  checked: boolean
  /** Why the switch cannot be changed, or false when it can. */
  why: string | false
  onChange: (on: boolean) => void
}) {
  return (
    <label className="movement-switch">
      <input
        type="checkbox"
        checked={checked}
        {...off(why)}
        onChange={(event) => {
          if (!why) onChange(event.target.checked)
        }}
      />
      <span>{label}</span>
    </label>
  )
}

/** An effect type's row: its switch and, under it, its settings as name, range and start. */
function EffectRow({
  type,
  on,
  why,
  onChange,
}: {
  type: EffectType
  on: boolean
  why: string | false
  onChange: (on: boolean) => void
}) {
  return (
    <li className="movement-effect">
      <Switch label={type.title} checked={on} why={why} onChange={onChange} />
      {type.settings.length > 0 && <span className="movement-settings">{settingsLine(type)}</span>}
    </li>
  )
}

/** The Patches and Effects groups of the Movement tab: the side column and the full-screen panel. */
export function MotionControls(props: MotionControlsProps) {
  const { patches, motion } = props
  const waiting = !props.hasPicture && 'Choose a take on Make first: there is no picture to move'
  return (
    <div className="movement-groups">
      {patches !== null && patches.length > 0 && (
        <section className="movement-group" aria-label={MOVEMENT_WORDS.patches}>
          <h3>{MOVEMENT_WORDS.patches}</h3>
          <ul className="movement-list">
            {patches.map((patch) => (
              <li key={patch.id}>
                {patch.src ? (
                  <Switch
                    label={patch.title}
                    checked={props.patchesOn.has(patch.id)}
                    why={waiting}
                    onChange={(on) => props.onPatch(patch.id, on)}
                  />
                ) : (
                  <span className="movement-switch movement-switch-off">
                    {patchNoTake(patch.title)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="movement-group" aria-label={MOVEMENT_WORDS.effects}>
        <h3>{MOVEMENT_WORDS.effects}</h3>
        {motion.status === 'loading' && <p className="muted">{MOVEMENT_WORDS.effectsLoading}</p>}
        {motion.status === 'failed' && <p className="muted">{MOVEMENT_WORDS.effectsFailed}</p>}
        {motion.status === 'ready' && motion.module.types.length === 0 && (
          <p className="muted">{MOVEMENT_WORDS.noEffects}</p>
        )}
        {motion.status === 'ready' && motion.module.types.length > 0 && (
          <>
            <p className="muted">{effectsCount(motion.module.types.length, props.hasPicture)}</p>
            <ul className="movement-list">
              {motion.module.types.map((type) => (
                <EffectRow
                  key={type.type}
                  type={type}
                  on={props.effectsOn.has(type.type)}
                  why={waiting}
                  onChange={(on) => props.onEffect(type.type, on)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
