import { useRef, useState } from 'react'
import {
  cleanedUrl,
  clipUrl,
  originalUrl,
  takeUrl,
  useCleanedCopy,
  useCleanedLines,
  useCleaningLines,
  useParts,
  useSetClean,
} from '../../api'
import { firstEntry, hearEntries, loopingText } from '../../cleanup'
import { recordedLinesOf } from '../../inGame'
import { PauseIcon, PlayIcon } from '../../components/icons'
import { off } from '../../off'
import { CleanLines } from './CleanLines'
import { useCompareLoop, type Side } from './useCompareLoop'

/** The words of the panel, as agreed. */
const HINT_OFF = 'Lowers the background noise in the pauses of every line recorded from now on.'
const HINT_ON = 'Every line recorded from now on has the background noise in its pauses lowered.'

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
  const cleaned = useCleanedLines(characterId, language)
  const cleaning = useCleaningLines(characterId, language)
  const switchRef = useRef<HTMLInputElement>(null)
  // The switch was moved off while lines in the game are cleaned: nothing is saved until the question is answered.
  const [askOff, setAskOff] = useState(false)
  const saved = save.isPending ? save.variables : clean
  const shown = askOff ? false : saved
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

  // A line already cleaned in the game is heard from its kept original and from the game's clip.
  const inGame =
    'part' in selected.source &&
    cleaned.data?.cleanedFiles.some(
      (f) =>
        'part' in selected.source &&
        f.part === selected.source.part &&
        f.file === selected.source.file,
    ) === true
  const [wanted, setWanted] = useState(false)
  const copy = useCleanedCopy(selected.missing || inGame ? null : selected.source, wanted, language)
  const ready = inGame || copy.data?.ok === true
  const failure =
    copy.data && !copy.data.ok ? copy.data.message : copy.isError ? copy.error.message : null
  const making = wanted && !ready && !failure && !selected.missing
  const heard: Side = ready ? side : 'recorded'
  const recordedUrl =
    inGame && 'part' in selected.source
      ? originalUrl(selected.source.part, selected.source.file, language)
      : selected.url
  const cleanedSide = inGame ? selected.url : copy.data?.ok ? cleanedUrl(copy.data.name) : null
  const loop = useCompareLoop(
    selected.missing ? null : recordedUrl,
    ready ? cleanedSide : null,
    side,
  )
  // The copy is asked for from the first press of play until the loop is stopped.
  if (wanted !== loop.playing) setWanted(loop.playing)
  const lit: Side = loop.playing ? heard : side
  // The line the menu opens on is not known until the parts are in: playing before would play the take.
  const loading = loaded.some((part) => part.isPending)
  const waitForTake = selected.missing ? 'Wait for the take to be made.' : false
  const playWhy = waitForTake || (loading && !loop.playing && 'The recorded lines are loading.')
  const flipWhy = waitForTake || (making && 'The cleaned version is being made.') || failure
  const flipDisabled = Boolean(flipWhy)

  /** Saves the switch off, then puts every cleaned line back (a cleaning still going on is stopped first). */
  async function switchOffAndPutBack() {
    setAskOff(false)
    save.reset()
    try {
      const job = cleaned.data?.job
      if (job?.kind === 'clean' && (job.status === 'running' || job.status === 'stopping')) {
        await cleaning.stop.mutateAsync()
      }
      if (!(await save.mutateAsync(false)).ok) return
      // The cleaning in hand finishes its line first: asked again until the studio takes it.
      for (let tries = 0; tries < 40; tries++) {
        const answer = await cleaning.putBack.mutateAsync()
        if (!('error' in answer) || !answer.error.includes('already')) return
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    } catch {
      // The save's own error is shown under the switch; a put back that failed shows in the panel.
    }
  }

  return (
    <div className="clean-up">
      <div className="clean-row">
        <label className="clean-switch">
          <input
            type="checkbox"
            role="switch"
            checked={shown}
            ref={switchRef}
            onChange={() => {
              // Moving the switch back on while the question is open is "Keep it on".
              if (askOff) return setAskOff(false)
              if (shown && (cleaned.data?.cleaned ?? 0) > 0) return setAskOff(true)
              save.reset()
              save.mutate(!shown)
            }}
          />
          <span className="clean-track" aria-hidden="true" />
          <span>Clean up the voice</span>
        </label>
      </div>
      <p className="clean-hint">{shown ? HINT_ON : HINT_OFF}</p>
      <CleanLines
        characterId={characterId}
        language={language}
        on={shown}
        askOff={askOff}
        data={cleaned.data}
        onKeepOn={() => {
          setAskOff(false)
          switchRef.current?.focus()
        }}
        onSwitchOff={() => void switchOffAndPutBack()}
        switchRef={switchRef}
      />
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
            {...off(playWhy)}
            onClick={() => !playWhy && loop.toggle()}
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
              : making
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
