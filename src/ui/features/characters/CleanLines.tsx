import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { type CleanedLines, type CleaningLines } from '../../api'
import { off } from '../../off'
import {
  allCleanedText,
  cleanButtonText,
  askCleanTitle,
  askPutBackTitle,
  cleaningText,
  countText,
  couldntCleanText,
  couldntPutBackText,
  notCleaned,
  puttingBackText,
  stillCleanedText,
} from '../../cleanLines'

/** A question with two buttons, the second confirming: focus starts on it, Escape is the first. */
function Ask({
  title,
  notes,
  no,
  yes,
  onNo,
  onYes,
}: {
  title: string
  notes: string[]
  no: string
  yes: string
  onNo: () => void
  onYes: () => void
}) {
  const confirm = useRef<HTMLButtonElement>(null)
  useEffect(() => confirm.current?.focus(), [])
  return (
    <div
      className="clean-ask"
      role="group"
      aria-label={title}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onNo()
        }
      }}
    >
      <h3>{title}</h3>
      <ul>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <div className="clean-ask-buttons">
        <button type="button" className="btn" onClick={onNo}>
          {no}
        </button>
        <button type="button" className="btn btn-primary" ref={confirm} onClick={onYes}>
          {yes}
        </button>
      </div>
    </div>
  )
}

/** The bar and the line over it, while a job goes on. */
function Progress({ text, done, total }: { text: string; done: number; total: number }) {
  return (
    <div className="clean-progress" role="status">
      <span>{text}</span>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

/**
 * What the Voice panel says under the clean-up switch about the voice's lines already in the game
 * (§8.4): the count with its button, the question before cleaning, the progress of cleaning or
 * putting back, what could not be done, and the question before switching off (`askOff`, the
 * switch having been moved but not saved). The work is the studio's, so it goes on when the page
 * is left; this only shows where it has got to.
 */
export function CleanLines({
  cleaning,
  on,
  askOff,
  data,
  onKeepOn,
  onSwitchOff,
  switchRef,
}: {
  /** The page's clean, put back and stop, shared with its switch. */
  cleaning: CleaningLines
  /** Whether the voice's clean-up is on as shown. */
  on: boolean
  /** The switch was moved off, and the question before saving it is open. */
  askOff: boolean
  data: CleanedLines | null | undefined
  /** "Keep it on", or Escape, in the question before switching off. */
  onKeepOn: () => void
  /** "Switch off and put back": the page saves the switch, then asks for the lines to be put back. */
  onSwitchOff: () => void
  /** The switch, where focus goes when a button it was on has gone. */
  switchRef: RefObject<HTMLInputElement | null>
}) {
  const { clean, putBack, stop } = cleaning
  const [asking, setAsking] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const job = data?.job ?? null
  const busy = job?.status === 'running' || job?.status === 'stopping'

  // Focus goes back to the button that opened the question when it is closed without an answer.
  const [returning, setReturning] = useState(false)
  useEffect(() => {
    if (returning && !asking) {
      opener.current?.focus()
      setReturning(false)
    }
  }, [returning, asking])

  // A button that had focus is gone when a job ends: focus goes to the switch.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const active = typeof document === 'undefined' ? null : document.activeElement
      if (!active || active === document.body) switchRef.current?.focus()
    }
    wasBusy.current = busy
  }, [busy, switchRef])

  if (!data) return null
  if (data.problem) {
    return <p className="adopt-error">The record of cleaned lines can’t be read: {data.problem}</p>
  }
  if (askOff) {
    return (
      <Ask
        title={askPutBackTitle(data.cleaned)}
        notes={[
          'Every line of this voice in the game goes back to how it was recorded.',
          'New lines are recorded without the clean-up.',
        ]}
        no="Keep it on"
        yes="Switch off and put back"
        onNo={onKeepOn}
        onYes={onSwitchOff}
      />
    )
  }
  if (busy && job) {
    return job.kind === 'clean' ? (
      <>
        <div className="clean-count">
          <span role="status">{cleaningText(job.done, job.total)}</span>
          <button
            type="button"
            className="btn"
            {...off(job.status === 'stopping' && 'Stopping after the line in hand.')}
            onClick={() => job.status === 'running' && stop.mutate()}
          >
            Stop
          </button>
        </div>
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${(job.done / job.total) * 100}%` }} />
        </div>
      </>
    ) : (
      <Progress text={puttingBackText(job.done, job.total)} done={job.done} total={job.total} />
    )
  }

  const failed = job && job.failed.length > 0 ? job : null
  const reason = failed?.failed[0]?.message ?? ''
  const refused = [clean, putBack].find((m) => m.data && 'error' in m.data)?.data
  const refusedText = refused && 'error' in refused ? refused.error : null

  if (!on) {
    if (data.cleaned === 0) return null
    const still = stillCleanedText(data.cleaned)
    return (
      <>
        <div className="clean-count">
          <span>{still.sentence}</span>
          <button type="button" className="btn" onClick={() => putBack.mutate()}>
            {still.button}
          </button>
        </div>
        {failed?.kind === 'putback' && (
          <p className="adopt-error">{couldntPutBackText(failed.failed.length, reason)}</p>
        )}
        {refusedText && <p className="adopt-error">{refusedText}</p>}
      </>
    )
  }

  if (data.total === 0) return null
  const left = notCleaned(data)
  if (left === 0) return <p className="clean-count">{allCleanedText(data.total)}</p>
  if (asking) {
    return (
      <Ask
        title={askCleanTitle(left)}
        notes={[
          'Their pauses get the same clean-up as new lines.',
          'The originals are kept. Switching the clean-up off puts them back.',
        ]}
        no="Cancel"
        yes={cleanButtonText(left)}
        onNo={() => {
          setAsking(false)
          setReturning(true)
        }}
        onYes={() => {
          setAsking(false)
          clean.mutate()
        }}
      />
    )
  }
  const count = countText(left, data.total)
  return (
    <>
      <div className="clean-count">
        <span>{count.sentence}</span>
        <button
          type="button"
          className="btn"
          ref={opener}
          onClick={() => {
            clean.reset()
            setAsking(true)
          }}
        >
          {count.button}
        </button>
      </div>
      {failed?.kind === 'clean' && (
        <p className="adopt-error">{couldntCleanText(failed.failed.length, reason)}</p>
      )}
      {refusedText && <p className="adopt-error">{refusedText}</p>}
    </>
  )
}
