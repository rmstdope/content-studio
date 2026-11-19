import { useEffect, useId, useRef, useState } from 'react'
import { LEVEL, LEVEL_WAIT } from '../../../core/level'
import { useSetLevel, type CleanedLines } from '../../api'
import {
  askLevelNotes,
  askLevelTitle,
  behindText,
  couldntSetText,
  LEVEL_HINT,
  levelCouldntSaveText,
  rewritingText,
  SOFTENED,
  unsetText,
} from '../../level'
import { off } from '../../off'
import { Ask } from './CleanLines'

/** Where a level sits along the slider, as a percentage of its width. */
const along = (level: number) => ((level - LEVEL.min) / (LEVEL.max - LEVEL.min)) * 100

/**
 * The Voice panel's Level (§8.4, as-ohm7): a slider for how loud the voice plays, 10% to 200%.
 * Moving it only changes what is heard (`trial`, kept by the panel so the loop can follow it); Set
 * saves it for the voice and language and, when lines are in the game, asks first, since they are
 * rewritten by a job the studio carries on if the page is left. What was not set is forgotten
 * with the page.
 */
export function LevelControl({
  characterId,
  language,
  saved,
  data,
  trial,
  onTrial,
  cleaning,
}: {
  characterId: string
  language?: string
  /** The level as saved for the voice in the language, in percent. */
  saved: number
  data: CleanedLines | null | undefined
  /** The slider's place when it was moved and not set; null: it is at the saved level. */
  trial: number | null
  onTrial: (level: number | null) => void
  /** The voice's lines are being cleaned, or put back: nothing can be set meanwhile. */
  cleaning: boolean
}) {
  const id = useId()
  const set = useSetLevel(characterId, language)
  const [asking, setAsking] = useState(false)
  const [returning, setReturning] = useState(false)
  const slider = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const job = data?.levelJob ?? null
  const rewriting = job?.status === 'running'
  const total = data?.total ?? 0
  const shown = trial ?? saved
  const differs = trial !== null && trial !== saved

  // Focus goes back to the button that opened the question when it is closed without an answer.
  useEffect(() => {
    if (returning && !asking) {
      opener.current?.focus()
      setReturning(false)
    }
  }, [returning, asking])

  // A button that had focus is gone when the rewriting ends: focus goes to the slider.
  const wasRewriting = useRef(false)
  useEffect(() => {
    if (wasRewriting.current && !rewriting) {
      const active = typeof document === 'undefined' ? null : document.activeElement
      if (!active || active === document.body) slider.current?.focus()
    }
    wasRewriting.current = rewriting
  }, [rewriting])

  const reason = set.isError
    ? set.error.message
    : set.data && !set.data.ok
      ? (set.data.problems[0]?.message ?? 'it was refused')
      : null
  const save = (level: number) => {
    setAsking(false)
    set.mutate(level, { onSuccess: (answer) => answer.ok && onTrial(null) })
  }

  const behind = (data?.levels ?? []).filter((line) => line.level !== saved)
  const failed = job && job.failed.length > 0 ? job : null

  let below = null
  if (rewriting && job) {
    below = (
      <div className="clean-progress" role="status">
        <span>{rewritingText(job.level, job.done, job.total)}</span>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} />
        </div>
      </div>
    )
  } else if (differs && asking) {
    below = (
      <Ask
        title={askLevelTitle(shown)}
        notes={askLevelNotes(shown, total)}
        no="Cancel"
        yes={`Set ${shown}%`}
        onNo={() => {
          setAsking(false)
          setReturning(true)
        }}
        onYes={() => save(shown)}
      />
    )
  } else if (differs) {
    below = (
      <>
        <div className="clean-count level-unset">
          <span>{unsetText(saved)}</span>
          <span className="level-buttons">
            <button
              type="button"
              className="btn"
              onClick={() => {
                set.reset()
                onTrial(null)
              }}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-primary"
              ref={opener}
              {...off(cleaning && LEVEL_WAIT)}
              onClick={() => {
                if (cleaning) return
                set.reset()
                if (total > 0) setAsking(true)
                else save(shown)
              }}
            >
              {total > 0 ? `Set ${shown}%…` : `Set ${shown}%`}
            </button>
          </span>
        </div>
        {cleaning && <p className="clean-hint">{LEVEL_WAIT}</p>}
      </>
    )
  } else if (behind.length > 0) {
    below = (
      <div className="clean-count level-unset">
        <span>{behindText(behind.length, behind[0]!.level)}</span>
        <button type="button" className="btn" onClick={() => save(saved)}>
          {`Set them to ${saved}%`}
        </button>
      </div>
    )
  }

  return (
    <div className="level">
      <div className="level-row">
        <label className="label" htmlFor={id}>
          Level
        </label>
        <div className="level-slider">
          <input
            id={id}
            ref={slider}
            type="range"
            min={LEVEL.min}
            max={LEVEL.max}
            step={LEVEL.step}
            value={shown}
            disabled={rewriting}
            aria-valuetext={`${shown}%`}
            onChange={(event) => {
              const value = Number(event.target.value)
              set.reset()
              setAsking(false)
              onTrial(value === saved ? null : value)
            }}
          />
          <span
            className="level-tick"
            style={{ left: `${along(LEVEL.default)}%` }}
            aria-hidden="true"
          />
          <div className="level-scale" aria-hidden="true">
            <span style={{ left: 0 }}>{LEVEL.min}%</span>
            <span style={{ left: `${along(LEVEL.default)}%` }}>{LEVEL.default}%</span>
            <span style={{ right: 0 }}>{LEVEL.max}%</span>
          </div>
        </div>
        <strong className="level-pct">{shown}%</strong>
      </div>
      {shown > LEVEL.default && <p className="clean-hint">{SOFTENED}</p>}
      {below}
      {reason && <p className="adopt-error">{levelCouldntSaveText(reason)}</p>}
      {!differs && failed && behind.length > 0 && !rewriting && (
        <p className="adopt-error">
          {couldntSetText(failed.failed.length, saved, failed.failed[0]!.message)}
        </p>
      )}
      <p className="clean-hint">{LEVEL_HINT}</p>
    </div>
  )
}
