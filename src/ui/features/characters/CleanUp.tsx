import { useState } from 'react'
import { cleanedUrl, clipUrl, takeUrl, useCleanedCopy, useParts, useSetClean } from '../../api'
import { firstEntry, hearEntries, loopingText } from '../../cleanup'
import { recordedLinesOf } from '../../inGame'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { off } from '../../off'
import { useCompareLoop, type Side } from './useCompareLoop'

/** The words of the panel, as agreed. */
const HINT_OFF =
  'Lowers the background noise in the pauses of every line recorded from now on. Lines already recorded stay as they are.'
const HINT_ON =
  'Every line recorded from now on has the background noise in its pauses lowered. Lines already recorded stay as they are.'

/**
 * The Voice panel's clean-up: the switch for the voice in the language shown (saved the moment it
 * is flipped), and under it a way to hear what it does: one line looping, flipped between as
 * recorded and cleaned without starting over. Mounted again for each language, so the choice of
 * line and the flip start from the first recorded line, as recorded.
 */
export function CleanUp({
  characterId,
  language,
  clean,
  takeKey,
  parts,
  speaker,
}: {
  characterId: string
  /** The language shown, in a project with several. */
  language?: string
  /** Whether the voice is switched on, as saved. */
  clean: boolean
  /** The key of the character's take of the audition phrase; null until it is made. */
  takeKey: string | null
  /** The character's parts, whose recorded lines can be heard. */
  parts: { id: string; title: string }[]
  /** The character's id in the dialog, to find its lines. */
  speaker: string
}) {
  const save = useSetClean(characterId, language)
  const shown = save.isPending ? save.variables : clean
  const reason = save.isError
    ? save.error.message
    : save.data && !save.data.ok
      ? 'problems' in save.data
        ? (save.data.problems[0]?.message ?? 'it was refused')
        : 'it was refused'
      : null

  const loaded = useParts(
    parts.map((p) => p.id),
    language,
  )
  const lines = recordedLinesOf(
    parts.map((p, i) => ({
      ...p,
      lines: loaded[i]?.data?.ok ? loaded[i].data.part.lines : null,
    })),
    speaker,
  )
  const entries = hearEntries(takeKey, takeKey ? takeUrl(takeKey) : null, lines, (line) =>
    clipUrl(line.part, line.file, language),
  )
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = entries.find((e) => e.id === chosen) ?? firstEntry(entries)
  const [side, setSide] = useState<Side>('recorded')

  const [wanted, setWanted] = useState(false)
  const copy = useCleanedCopy(selected.missing ? null : selected.source, wanted, language)
  const ready = copy.data?.ok === true
  const failure =
    copy.data && !copy.data.ok ? copy.data.message : copy.isError ? copy.error.message : null
  const cleaning = wanted && !ready && !failure && !selected.missing
  const heard: Side = ready ? side : 'recorded'
  const loop = useCompareLoop(
    selected.missing ? null : selected.url,
    ready && copy.data?.ok ? cleanedUrl(copy.data.name) : null,
    side,
  )
  // The copy is asked for from the first press of play until the loop is stopped.
  if (wanted !== loop.playing) setWanted(loop.playing)
  const lit: Side = loop.playing ? heard : side
  const waitForTake = selected.missing ? 'Wait for the take to be made.' : false
  const flipWhy = waitForTake || (cleaning && 'The cleaned version is being made.') || failure
  const flipDisabled = typeof flipWhy === 'string' && flipWhy !== ''

  return (
    <div className="clean-up">
      <div className="clean-row">
        <label className="clean-switch">
          <input
            type="checkbox"
            role="switch"
            checked={shown}
            onChange={() => {
              save.reset()
              save.mutate(!shown)
            }}
          />
          <span className="clean-track" aria-hidden="true" />
          <span>Clean up the voice</span>
        </label>
      </div>
      <p className="clean-hint">{shown ? HINT_ON : HINT_OFF}</p>
      {reason && <p className="adopt-error">Couldn’t save the clean-up: {reason}</p>}

      <div className="clean-hear">
        <label className="clean-menu">
          <span className="label">Hear it on</span>
          <select
            value={selected.id}
            title={selected.label}
            onChange={(event) => {
              setChosen(event.target.value)
              setSide('recorded')
            }}
          >
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.label}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <div className="clean-play">
          <button
            type="button"
            className="icon-btn"
            aria-label={loop.playing ? 'Stop' : 'Play'}
            {...off(waitForTake)}
            onClick={() => !waitForTake && loop.toggle()}
          >
            {loop.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div
            className={`clean-ab${flipDisabled ? ' dim' : ''}`}
            role="group"
            aria-label="Hear the line"
          >
            {(['recorded', 'cleaned'] as const).map((half) => (
              <button
                key={half}
                type="button"
                className={lit === half ? 'on' : undefined}
                aria-pressed={lit === half}
                {...off(flipWhy)}
                onClick={() =>
                  !flipDisabled && setSide(side === 'recorded' ? 'cleaned' : 'recorded')
                }
              >
                {half === 'recorded' ? 'As recorded' : 'Cleaned'}
              </button>
            ))}
          </div>
          <span className="muted clean-time">
            {selected.missing
              ? 'Wait for the take to be made.'
              : cleaning
                ? 'Cleaning…'
                : loop.playing
                  ? loopingText(loop.position, loop.length)
                  : null}
          </span>
        </div>
      </div>
      {failure && <p className="adopt-error">The cleaned version couldn’t be made: {failure}</p>}
    </div>
  )
}
