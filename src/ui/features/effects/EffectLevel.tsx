import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  EFFECT_LEVEL,
  levelFailedChosenLine,
  levelFailedOtherLine,
  levelGameLine,
  levelPercent,
  levelTooLoud,
  levelWritingLine,
  tooLoudLine,
} from '../../../core/effectLevel'
import type { EffectTakeView } from '../../../core/effectTakes'
import { useSetEffectLevel } from '../../api'
import { takePlayId } from '../../effectsPlay'
import { EFFECTS_LOCK_UNREAD } from '../../effectsText'
import { off } from '../../off'
import { useTrackActions } from '../../trackActions'
import type { Player } from './EffectInTheGame'

/** How long after the last arrow key press a level is saved, in milliseconds. */
export const LEVEL_SAVE_DELAY_MS = 500

/**
 * A sound effect take's level: the value the slider shows now (a fraction, 1 as made), which the
 * waveform and the player follow while it is dragged, and the `row` to place under the waveform
 * (null for a take that is not there). Dragging plays the take louder or quieter at once; letting
 * go of the mouse saves it, and an arrow key does half a second after the last press. A take in
 * the game says what the game plays and, while the game's sound is written, that it is; a failed
 * save puts the slider back to the saved level and says why. The red line is about the take shown
 * and the last level pressed on the page (the page's {@link TrackActions}).
 */
export function useEffectLevel({
  effect,
  take,
  inGame,
  locked,
  player,
}: {
  effect: string
  take: EffectTakeView | undefined
  /** The take is the one the game plays. */
  inGame: boolean
  /** The effects lock cannot be read: levels wait. */
  locked: boolean
  player: Player
}): { level: number; row: ReactNode } {
  const set = useSetEffectLevel(effect)
  const actions = useTrackActions()
  const saved = take?.level ?? 1
  const [value, setValue] = useState(saved)
  const dragging = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  // What the latest press saves, which the key timer calls.
  const saveLatest = useRef<(level: number) => void>(() => {})
  // The slider follows what is saved when that changes (another take shown, a reload), except while
  // it is being moved; a save's own answer needs no follow, and a failed one puts it back.
  useEffect(() => {
    if (!dragging.current && timer.current === null) setValue(saved)
  }, [saved, take?.file])
  useEffect(() => clear, [])
  if (!take) return { level: 1, row: null }

  const playId = takePlayId(effect, take.n)
  const hear = (level: number) => {
    player.setLevel(playId, level)
    player.setLevel(`${playId}-seam`, level)
  }
  const save = (next: number) => {
    clear()
    if (locked || next === saved) return
    actions.press(`level:${take.n}`)
    const was = saved
    const back = () => {
      setValue(was)
      hear(was)
    }
    set.mutate(
      { file: take.file, level: next },
      { onSuccess: (result) => !result.ok && back(), onError: back },
    )
  }
  saveLatest.current = save
  const move = (percent: number) => {
    if (locked) return
    const next = percent / 100
    setValue(next)
    hear(next)
    clear()
    if (!dragging.current)
      timer.current = setTimeout(() => saveLatest.current(next), LEVEL_SAVE_DELAY_MS)
  }
  const reset = () => {
    if (locked) return
    setValue(1)
    hear(1)
    save(1)
  }
  const percent = Math.round(value * 100)
  const failed = set.variables?.file === take.file && actions.shows(`level:${take.n}`)
  const reason = !failed
    ? null
    : set.isError
      ? set.error.message
      : set.data && !set.data.ok
        ? 'message' in set.data
          ? set.data.message
          : 'the level could not be saved'
        : null
  const writing = inGame && set.isPending && set.variables?.file === take.file
  const line = writing
    ? levelWritingLine(set.variables.level)
    : inGame && saved !== 1
      ? levelGameLine(saved)
      : null
  const why = locked && EFFECTS_LOCK_UNREAD
  return {
    level: value,
    row: (
      <div className="effect-level">
        <div className="effect-level-row">
          <span className="small">Level</span>
          <input
            type="range"
            min={EFFECT_LEVEL.min * 100}
            max={EFFECT_LEVEL.max * 100}
            step={EFFECT_LEVEL.step * 100}
            value={percent}
            aria-label={`Level of take ${take.n}`}
            aria-valuetext={levelPercent(value)}
            {...off(why)}
            onChange={(event) => move(Number(event.target.value))}
            onPointerDown={() => {
              if (!locked) dragging.current = true
            }}
            onPointerUp={(event) => {
              dragging.current = false
              save(Number(event.currentTarget.value) / 100)
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          />
          <b className="scene-level">{levelPercent(value)}</b>
          {percent !== 100 && (
            <button
              type="button"
              className="btn btn-ghost btn-small level-reset"
              {...off(why)}
              onClick={reset}
            >
              Back to 100%
            </button>
          )}
        </div>
        {line && <span className="faint small">{line}</span>}
        {levelTooLoud(take.peaks, value) && (
          <span className="take-quiet">{tooLoudLine(value, take.peaks)}</span>
        )}
        {reason !== null && (
          <span className="adopt-error" role="alert">
            {inGame
              ? levelFailedChosenLine(take.n, reason, saved)
              : levelFailedOtherLine(take.n, reason)}
          </span>
        )}
      </div>
    ),
  }
}
