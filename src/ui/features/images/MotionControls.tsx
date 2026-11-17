import { useId, useRef } from 'react'
import type { SavedEffects } from '../../../core/images'
import type { EffectSetting, EffectType } from '../../../core/motion'
import {
  clampSetting,
  effectDiffers,
  effectValues,
  rangeNote,
  settingsLine,
  valueText,
} from '../../../core/motion'
import {
  EFFECT_WORDS,
  MOVEMENT_WORDS,
  SPOT_WORDS,
  effectsLine,
  finishFirst,
  patchNoTake,
  savedForGame,
  spotLine,
} from '../../motionText'
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
  /** The effects the image has saved, in the game or not, by type. */
  effects: SavedEffects
  /** An effect is switched on or off. */
  onEffect: (type: EffectType, on: boolean) => void
  /** A slider moves (live: the picture follows, nothing is saved until `onCommit`). */
  onSetting: (type: EffectType, setting: EffectSetting, value: number) => void
  /** A slider was let go of, or moved with the keyboard: save what is set. */
  onCommit: () => void
  /** Reset presses: an effect's sliders go back to their starting values (and save). */
  onReset: (type: EffectType) => void
  /** Remove presses on an effect the renderer no longer has. */
  onRemove: (type: string) => void
  /** What saving the effects is doing. */
  status: SaveStatus
  /** Try again presses after a save failed. */
  onRetry: () => void
  /** Whether the failed save was of a spot, which has its own words. */
  failedSpot?: boolean
  /** Drawing spots, on the tab only: absent (full screen), the spot line has no links. */
  spot?: SpotControls
}

/** What an effect's spot line can do on the tab: draw, clear, show the shapes, and why it cannot. */
export interface SpotControls {
  /** The type being drawn now, or null. */
  drawing: string | null
  /** Why no spot can be drawn (there is no picture), or false. */
  why: string | false
  /** Draw a spot / Change presses. */
  onDraw: (type: EffectType) => void
  /** Clear presses. */
  onClear: (type: EffectType) => void
  /** Pointer or focus came to or left an effect's row; null when it left. */
  onPeek: (type: string | null) => void
  /** The type whose unclosed shape was just left out. */
  leftOut: string | null
}

/** What an effect's row says of its spot, and the links for it where there are any. */
function SpotLine({
  type,
  count,
  on,
  props,
}: {
  type: EffectType
  count: number
  on: boolean
  props: MotionControlsProps
}) {
  const spot = props.spot
  if (!on) {
    return count > 0 ? <p className="movement-spot muted">{spotLine(count, 'off')}</p> : null
  }
  const drawing = spot?.drawing === type.type
  const other = spot?.drawing != null && !drawing
  const why = spot
    ? other
      ? finishFirst(props.effects[spot.drawing!]?.title ?? spot.drawing!)
      : spot.why
    : false
  const link = (label: string, press: () => void) => (
    <button
      type="button"
      className="link-button"
      data-spot-link={type.type}
      {...off(why)}
      onClick={() => !why && press()}
    >
      {label}
    </button>
  )
  return (
    <div className="movement-spot-block">
      <p className="movement-spot muted">
        {spotLine(count, drawing ? 'drawing' : 'plain')}
        {spot && !drawing && count === 0 && link(SPOT_WORDS.draw, () => spot.onDraw(type))}
        {spot && !drawing && count > 0 && link(SPOT_WORDS.change, () => spot.onDraw(type))}
        {spot && !drawing && count > 0 && link(SPOT_WORDS.clear, () => spot.onClear(type))}
      </p>
      {spot && !drawing && why && <p className="movement-spot-why muted">{why}</p>}
      {spot?.leftOut === type.type && <p className="movement-spot-why">{SPOT_WORDS.leftOut}</p>}
    </div>
  )
}

/** What saving the effects is doing: nothing to say, taking a moment, done, or failed. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

/** One switch with its label, which cannot be changed while it has a `why`. */
function Switch({
  label,
  checked,
  why,
  dim,
  onChange,
}: {
  label: string
  checked: boolean
  /** Shown faint: the switch is there but cannot be used. */
  dim?: boolean
  /** Why the switch cannot be changed, or false when it can. */
  why: string | false
  onChange: (on: boolean) => void
}) {
  return (
    <label className={dim ? 'movement-switch movement-switch-off' : 'movement-switch'}>
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

/** One setting's slider: its name, the slider and its value as a plain number. */
function SettingSlider({
  setting,
  value,
  onChange,
  onCommit,
}: {
  setting: EffectSetting
  value: number
  onChange: (value: number) => void
  onCommit: () => void
}) {
  const id = useId()
  // A pointer drag saves on letting go; every other change (the keyboard) saves at once.
  const down = useRef(false)
  return (
    <div className="movement-slider">
      <label htmlFor={id}>{setting.title}</label>
      <input
        id={id}
        type="range"
        min={setting.min}
        max={setting.max}
        step={setting.step}
        value={value}
        onPointerDown={() => (down.current = true)}
        onPointerUp={() => {
          down.current = false
          onCommit()
        }}
        onPointerCancel={() => {
          down.current = false
          onCommit()
        }}
        onChange={(event) => {
          onChange(clampSetting(setting, Number(event.target.value)))
          if (!down.current) onCommit()
        }}
      />
      <output htmlFor={id}>{valueText(value)}</output>
    </div>
  )
}

/** An effect type's row: its switch and, off, its settings as a line; on, a slider for each. */
function EffectRow({
  type,
  saved,
  on,
  why,
  props,
}: {
  type: EffectType
  saved: SavedEffects[string] | undefined
  on: boolean
  why: string | false
  props: MotionControlsProps
}) {
  const values = effectValues(type, saved?.settings)
  return (
    <li
      className={
        props.spot?.drawing === type.type
          ? 'movement-effect movement-effect-drawing'
          : 'movement-effect'
      }
      onPointerEnter={() => props.spot?.onPeek(type.type)}
      onPointerLeave={() => props.spot?.onPeek(null)}
      onFocus={() => props.spot?.onPeek(type.type)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          props.spot?.onPeek(null)
        }
      }}
    >
      <div className="movement-effect-head">
        <Switch
          label={type.title}
          checked={on}
          why={why}
          onChange={(next) => props.onEffect(type, next)}
        />
        {on && effectDiffers(type, saved?.settings) && (
          <button type="button" className="btn movement-reset" onClick={() => props.onReset(type)}>
            {EFFECT_WORDS.reset}
          </button>
        )}
      </div>
      {!on && type.settings.length > 0 && (
        <span className="movement-settings">{settingsLine(type)}</span>
      )}
      {on &&
        type.settings.map((setting) => (
          <SettingSlider
            key={setting.id}
            setting={setting}
            value={values[setting.id]!}
            onChange={(value) => props.onSetting(type, setting, value)}
            onCommit={props.onCommit}
          />
        ))}
      {on &&
        type.settings.map((setting) => {
          const note = rangeNote(setting, saved?.settings[setting.id])
          return (
            note && (
              <p key={setting.id} className="movement-range-note notice-warn">
                {note}
              </p>
            )
          )
        })}
      <SpotLine type={type} count={saved?.spot?.length ?? 0} on={on} props={props} />
    </li>
  )
}

/** The Patches and Effects groups of the Movement tab: the side column and the full-screen panel. */
export function MotionControls(props: MotionControlsProps) {
  const { patches } = props
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
                    why={false}
                    onChange={(on) => props.onPatch(patch.id, on)}
                  />
                ) : (
                  <Switch
                    label={patchNoTake(patch.title)}
                    checked={false}
                    why="No take chosen yet"
                    dim
                    onChange={() => {}}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <EffectsGroup {...props} />
    </div>
  )
}

/** The Effects group: every effect the renderer has with its switch, and the ones saved that it no longer has. */
function EffectsGroup(props: MotionControlsProps) {
  const { motion, effects, status } = props
  const types = motion.status === 'ready' ? motion.module.types : []
  const known = new Set(types.map((t) => t.type))
  const gone = Object.keys(effects).filter((type) => !known.has(type))
  const onCount = types.filter((t) => effects[t.type]?.on).length
  const saveWords =
    status === 'saving' ? EFFECT_WORDS.saving : status === 'saved' ? EFFECT_WORDS.saved : null
  const nameOf = (type: string) => effects[type]?.title ?? type
  const switchedOn = Object.keys(effects)
    .filter((type) => effects[type]!.on)
    .map(nameOf)
  return (
    <section className="movement-group" aria-label={MOVEMENT_WORDS.effects}>
      <div className="movement-group-head">
        <h3>{MOVEMENT_WORDS.effects}</h3>
        {saveWords && (
          <span className="movement-save muted" role="status">
            {saveWords}
          </span>
        )}
      </div>
      {motion.status === 'loading' && <p className="muted">{MOVEMENT_WORDS.effectsLoading}</p>}
      {motion.status === 'failed' && (
        <p className="muted">
          {switchedOn.length > 0 ? savedForGame(switchedOn) : MOVEMENT_WORDS.effectsFailed}
        </p>
      )}
      {motion.status === 'ready' && types.length === 0 && (
        <p className="muted">{MOVEMENT_WORDS.noEffects}</p>
      )}
      {motion.status === 'ready' && types.length > 0 && (
        <p className="muted">{effectsLine(onCount, types.length)}</p>
      )}
      {motion.status === 'ready' && (types.length > 0 || gone.length > 0) && (
        <ul className="movement-list">
          {types.map((type) => (
            <EffectRow
              key={type.type}
              type={type}
              saved={effects[type.type]}
              on={effects[type.type]?.on === true}
              why={false}
              props={props}
            />
          ))}
          {gone.map((type) => (
            <li key={type} className="movement-effect movement-effect-gone">
              <div className="movement-effect-head">
                <strong>{nameOf(type)}</strong>
                <button type="button" className="btn" onClick={() => props.onRemove(type)}>
                  {EFFECT_WORDS.remove}
                </button>
              </div>
              <p className="notice-warn">{EFFECT_WORDS.gone}</p>
            </li>
          ))}
        </ul>
      )}
      {status === 'failed' && (
        <p role="alert" className="movement-save-failed">
          {props.failedSpot ? SPOT_WORDS.saveFailed : EFFECT_WORDS.saveFailed}{' '}
          <button type="button" className="btn" onClick={props.onRetry}>
            {MOVEMENT_WORDS.tryAgain}
          </button>
        </p>
      )}
    </section>
  )
}
