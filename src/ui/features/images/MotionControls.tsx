import { type Chosen } from '../../../core/lockRead'
import { type Ref, useId, useRef } from 'react'
import type { SavedEffects, SavedZoom } from '../../../core/images'
import type { EffectSetting, EffectType, SpotView } from '../../../core/motion'
import {
  clampSetting,
  effectDiffers,
  effectValues,
  rangeNote,
  effectPlays,
  settingsLine,
  spotView,
  tieState,
  type TiePatch,
  valueText,
} from '../../../core/motion'
import {
  GAME_ZOOM,
  ZOOM_RANGE,
  percentText,
  secondsText,
  zoomDiffers,
  zoomRangeNotes,
  zoomValues,
} from '../../../core/zoom'
import {
  EFFECT_WORDS,
  MOVEMENT_WORDS,
  ZOOM_WORDS,
  zoomOffLine,
  zoomSavedLockUnread,
  SPOT_WORDS,
  effectsLine,
  finishFirst,
  PATCH_NOT_KNOWN_WHY,
  noTakeLine,
  notLaidLine,
  patchGoneLine,
  patchGoneWithoutLine,
  laidLine,
  patchNoTake,
  patchNotKnown,
  savedForGame,
  spotLine,
  savedForGameLockUnread,
  tieChoice,
  tieTag,
  TIE_WORDS,
} from '../../motionText'
import type { MotionState } from '../../api/images'
import { off } from '../../off'
import { handFocusOn } from './handFocusOn'

/** A patch of the image as the controls list it: its title and where its chosen take's picture is, if it has one. */
export interface MovementPatch {
  id: string
  title: string
  src: string | null
}

/** What the Patches and Effects groups show and change, the same in the side column and in full screen. */
export interface MotionControlsProps {
  /** The images lock cannot be read: nothing is said of which takes are chosen, and nothing can be changed. */
  chosen: Chosen
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
  /** The game's patches an effect can be tied to, in its order; none when the image has none. */
  ties: readonly TiePatch[]
  /** An effect is tied to a patch (its id), to show while it is laid or with `without` while it is not, or to none (null). */
  onTie: (type: EffectType, choice: { patchId: string; without: boolean } | null) => void
  /** Take it off presses: switch that patch off in the preview. */
  onTakeOff: (id: string) => void
  /** Lay it presses: switch that patch on in the preview. */
  onLay: (id: string) => void
  /** What saving the effects is doing. */
  status: SaveStatus
  /** Try again presses after a save failed. */
  onRetry: () => void
  /** Whether the failed save was of a spot, which has its own words. */
  failedSpot?: boolean
  /** The slow zoom the image has saved; undefined when nothing is (the game's own). */
  zoom: SavedZoom | undefined
  /** What saving the zoom is doing. */
  zoomStatus: SaveStatus
  /** The zoom's switch is pressed. */
  onZoomOn: (on: boolean) => void
  /** One of the zoom's sliders moves (live: nothing is saved until `onZoomCommit`). */
  onZoomValue: (which: 'seconds' | 'percent', value: number) => void
  /** A zoom slider was let go of, or moved with the keyboard: save what is set. */
  onZoomCommit: () => void
  /** Reset presses: back to nothing saved. */
  onZoomReset: () => void
  /** Try again presses after the zoom could not be saved. */
  onZoomRetry: () => void
  /** Drawing spots, on the tab and in full screen: absent, the spot line has no links. */
  spot?: SpotControls
}

/** What an effect's spot line can do on the tab: draw your own, go back to the game's, undo that, show the shapes, and why it cannot. */
export interface SpotControls {
  /** The type being drawn now, or null. */
  drawing: string | null
  /** Why no spot can be drawn (there is no picture), or false. */
  why: string | false
  /** Draw your own / Change presses. */
  onDraw: (type: EffectType) => void
  /** Back to the game's / Remove it presses: the shapes and their mark go, with an Undo for a moment. */
  onBack: (type: EffectType) => void
  /** Undo presses: the shapes and mark just removed come back. */
  onUndo: (type: EffectType) => void
  /** The type whose shapes were just removed and can be brought back, or null. */
  undo: string | null
  /** Pointer or focus came to or left an effect's row; null when it left. */
  onPeek: (type: string | null) => void
  /** The type whose unclosed shape was just left out. */
  leftOut: string | null
}

/** What an effect's row says of its spot, and the links for it where there are any. */
function SpotLine({
  type,
  view,
  on,
  props,
}: {
  type: EffectType
  view: SpotView
  on: boolean
  props: MotionControlsProps
}) {
  const spot = props.spot
  if (!on) {
    return view.who === 'own' || (view.who === 'fixed' && view.kept) ? (
      <p className="movement-spot muted">
        {spotLine(view, 'off')}
        {view.who === 'fixed' && <span>{SPOT_WORDS.keptNotUsed}</span>}
      </p>
    ) : null
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
  const links = spot && !drawing
  const undone = links && spot.undo === type.type
  return (
    <div className="movement-spot-block">
      <p className="movement-spot muted">
        {spotLine(view, drawing ? 'drawing' : 'plain')}
        {links && view.who === 'game' && link(SPOT_WORDS.draw, () => spot.onDraw(type))}
        {links && view.who === 'own' && link(SPOT_WORDS.change, () => spot.onDraw(type))}
        {links && view.who === 'own' && link(SPOT_WORDS.back, () => spot.onBack(type))}
        {view.who === 'fixed' && view.kept && (
          <span className="movement-spot-note">{SPOT_WORDS.keptNotUsed}</span>
        )}
        {links &&
          view.who === 'fixed' &&
          view.kept &&
          link(SPOT_WORDS.removeIt, () => spot.onBack(type))}
        {undone && <span className="movement-spot-note">{SPOT_WORDS.removed}</span>}
        {undone && link(SPOT_WORDS.undo, () => spot.onUndo(type))}
      </p>
      {links && why && <p className="movement-spot-why muted">{why}</p>}
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
  inputRef,
  onChange,
}: {
  label: string
  checked: boolean
  /** The switch's own input, for focus to be put on it. */
  inputRef?: Ref<HTMLInputElement>
  /** Shown faint: the switch is there but cannot be used. */
  dim?: boolean
  /** Why the switch cannot be changed, or false when it can. */
  why: string | false
  onChange: (on: boolean) => void
}) {
  return (
    <label className={dim ? 'movement-switch movement-switch-off' : 'movement-switch'}>
      <input
        ref={inputRef}
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
  format = valueText,
  onChange,
  onCommit,
}: {
  setting: EffectSetting
  value: number
  /** The value as the output shows it. */
  format?: (value: number) => string
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
      <output htmlFor={id}>{format(value)}</output>
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
  const menu = useRef<HTMLSelectElement>(null)
  // Reset leaves with the press, so focus goes to this row's switch rather than the page body.
  const switchRef = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const tie = tieState(saved ?? {}, props.ties, props.patchesOn)
  const without = tie.kind !== 'always' && tie.without === true
  const current = tie.kind === 'always' ? '' : `${without ? 'without' : 'with'}:${tie.patchId}`
  const tiedAway = !effectPlays(tie)
  const classes = ['movement-effect']
  if (on && tiedAway) classes.push('movement-effect-dim')
  if (tie.kind === 'gone') classes.push('movement-effect-lost')
  return (
    <li
      className={
        props.spot?.drawing === type.type
          ? `${classes.join(' ')} movement-effect-drawing`
          : classes.join(' ')
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
          inputRef={switchRef}
          onChange={(next) => props.onEffect(type, next)}
        />
        {tie.kind !== 'always' && (
          <span className="movement-tag">{tieTag(tie.title, without)}</span>
        )}
        {on && effectDiffers(type, saved?.settings) && (
          <button
            type="button"
            className="btn movement-reset"
            onClick={() => {
              props.onReset(type)
              handFocusOn(() => switchRef.current)
            }}
          >
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
      {on && (props.ties.length > 0 || tie.kind === 'gone') && (
        <>
          <div className="movement-shows">
            <label htmlFor={menuId}>{TIE_WORDS.shows}</label>
            <select
              id={menuId}
              className="takes-count"
              ref={menu}
              value={current}
              onChange={(event) => {
                const [how, ...id] = event.target.value.split(':')
                props.onTie(
                  type,
                  id.length ? { patchId: id.join(':'), without: how === 'without' } : null,
                )
              }}
            >
              <option value="">{TIE_WORDS.always}</option>
              {props.ties.flatMap((patch) => [
                <option key={`with:${patch.id}`} value={`with:${patch.id}`}>
                  {tieChoice(patch.title)}
                </option>,
                <option key={`without:${patch.id}`} value={`without:${patch.id}`}>
                  {tieChoice(patch.title, false, true)}
                </option>,
              ])}
              {tie.kind === 'gone' && (
                <option value={current}>{tieChoice(tie.title, true, without)}</option>
              )}
            </select>
          </div>
          {without && tie.kind === 'laid' && (
            <p className="movement-tie-line muted">
              {laidLine(tie.title)}{' '}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  props.onTakeOff(tie.patchId)
                  menu.current?.focus()
                }}
              >
                {TIE_WORDS.takeOff}
              </button>
            </p>
          )}
          {!without && (tie.kind === 'notLaid' || tie.kind === 'noTake') && (
            <p className="movement-tie-line muted">
              {tie.kind === 'notLaid' ? notLaidLine(tie.title) : noTakeLine(tie.title)}{' '}
              {tie.kind === 'notLaid' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    props.onLay(tie.patchId)
                    menu.current?.focus()
                  }}
                >
                  {TIE_WORDS.lay}
                </button>
              )}
            </p>
          )}
          {tie.kind === 'gone' && (
            <p className="movement-tie-line notice-warn">
              {without ? patchGoneWithoutLine(tie.title) : patchGoneLine(tie.title)}
            </p>
          )}
        </>
      )}
      <SpotLine type={type} view={spotView(type.placement, saved)} on={on} props={props} />
    </li>
  )
}

/** The Patches and Effects groups of the Movement tab: the side column and the full-screen panel. */
export function MotionControls(props: MotionControlsProps) {
  const { patches } = props
  return (
    <div className="movement-groups">
      <ZoomGroup {...props} />
      {patches !== null && patches.length > 0 && (
        <section className="movement-group" aria-label={MOVEMENT_WORDS.patches}>
          <h3>{MOVEMENT_WORDS.patches}</h3>
          <ul className="movement-list">
            {patches.map((patch) => (
              <li key={patch.id}>
                {!props.chosen.known ? (
                  <Switch
                    label={patchNotKnown(patch.title)}
                    checked={false}
                    why={PATCH_NOT_KNOWN_WHY}
                    dim
                    onChange={() => {}}
                  />
                ) : patch.src ? (
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

/** The two sliders of the slow zoom as the shared slider takes them. */
const ZOOM_SLIDERS = [
  { which: 'seconds', title: ZOOM_WORDS.seconds, format: secondsText, ...ZOOM_RANGE.seconds },
  { which: 'percent', title: ZOOM_WORDS.percent, format: percentText, ...ZOOM_RANGE.percent },
] as const

/** The Slow zoom group: one switch and, on, two sliders; the studio's own, so it shows whatever the renderer does. */
function ZoomGroup(props: MotionControlsProps) {
  const { zoom, zoomStatus } = props
  const values = zoomValues(zoom)
  // Reset leaves with the press, so focus goes to the switch beside it rather than the page body.
  const switchRef = useRef<HTMLInputElement>(null)
  // The chip marks a state: "Saving…" while a save runs, else "Saved" whenever the image has a zoom saved (nothing saved, or a save that failed: none).
  const chip =
    zoomStatus === 'saving'
      ? ZOOM_WORDS.saving
      : zoom !== undefined && zoomStatus !== 'failed'
        ? ZOOM_WORDS.saved
        : null
  const heading = (
    <div className="movement-group-head">
      <h3>{ZOOM_WORDS.heading}</h3>
      {props.chosen.known && chip && (
        <span className="movement-save muted" role="status">
          {chip}
        </span>
      )}
    </div>
  )
  // The images lock cannot be read: what is saved, read-only; nothing can be changed or saved.
  if (!props.chosen.known) {
    const own = zoom ?? { on: true, ...GAME_ZOOM }
    return (
      <section className="movement-group" aria-label={ZOOM_WORDS.heading}>
        {heading}
        <p className="muted">
          {zoomSavedLockUnread(
            own.on
              ? `${secondsText(own.seconds)} each way, ${percentText(own.percent)}`
              : 'no zoom',
          )}
        </p>
      </section>
    )
  }
  const notes = zoomRangeNotes(zoom)
  return (
    <section className="movement-group" aria-label={ZOOM_WORDS.heading}>
      {heading}
      <div className="movement-effect-head">
        <Switch
          label={ZOOM_WORDS.switch}
          checked={values.on}
          why={false}
          inputRef={switchRef}
          onChange={props.onZoomOn}
        />
        {zoomDiffers(zoom) && (
          <button
            type="button"
            className="link-button movement-reset movement-zoom-reset"
            onClick={() => {
              props.onZoomReset()
              handFocusOn(() => switchRef.current)
            }}
          >
            {ZOOM_WORDS.reset}
          </button>
        )}
      </div>
      {!values.on && (
        <p className="movement-settings">
          {zoomOffLine(
            secondsText(zoom?.seconds ?? values.seconds),
            percentText(zoom?.percent ?? values.percent),
          )}
        </p>
      )}
      {values.on &&
        ZOOM_SLIDERS.map(({ which, title, format, min, max, step }) => (
          <SettingSlider
            key={which}
            setting={{ id: which, title, min, max, step, default: GAME_ZOOM[which] }}
            value={values[which]}
            format={format}
            onChange={(value) => props.onZoomValue(which, value)}
            onCommit={props.onZoomCommit}
          />
        ))}
      {values.on &&
        notes.map((note) => (
          <p key={note} className="movement-range-note notice-warn">
            {note}
          </p>
        ))}
      {zoomStatus === 'failed' && (
        <p role="alert" className="movement-save-failed">
          {ZOOM_WORDS.saveFailed}{' '}
          <button type="button" className="btn" onClick={props.onZoomRetry}>
            {MOVEMENT_WORDS.tryAgain}
          </button>
        </p>
      )}
    </section>
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
  // The lock cannot be read: the heading and what is saved, read-only; nothing can be changed or saved.
  if (!props.chosen.known) {
    return (
      <section className="movement-group" aria-label={MOVEMENT_WORDS.effects}>
        <div className="movement-group-head">
          <h3>{MOVEMENT_WORDS.effects}</h3>
        </div>
        <p className="muted">
          {switchedOn.length > 0
            ? savedForGameLockUnread(switchedOn)
            : MOVEMENT_WORDS.effectsLockNone}
        </p>
      </section>
    )
  }
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
