import type { CleanSource } from '../services/cleanedCopy'
import type { RecordedLine } from './inGame'

/** One thing the "Hear it on" menu offers: the take, or a recorded line. */
export interface HearEntry {
  /** Unique in the menu: `take`, or the line's id. */
  id: string
  label: string
  /** What the cleaned copy is made from. */
  source: CleanSource
  /** Where the recorded sound is heard from. */
  url: string
  /** The take with no sound yet. */
  missing?: true
}

/** The menu's first entry, the character's take of the audition phrase. */
export const TAKE_LABEL = 'The take (the audition phrase)'

/**
 * What the character's page offers to hear the clean-up on: the take first, then each recorded
 * line in the order the game plays them as "<part title> · “<line>”". The take has no sound
 * until it is made (`takeKey` null), which the entry says.
 */
export function hearEntries(
  takeKey: string | null,
  takeUrl: string | null,
  lines: RecordedLine[],
  clip: (line: RecordedLine) => string,
): HearEntry[] {
  const take: HearEntry =
    takeKey && takeUrl
      ? { id: 'take', label: TAKE_LABEL, source: { take: takeKey }, url: takeUrl }
      : { id: 'take', label: TAKE_LABEL, source: { take: '' }, url: '', missing: true }
  return [
    take,
    ...lines.map((line): HearEntry => ({
      id: line.id,
      label: `${line.title} · “${line.text}”`,
      source: { part: line.part, file: line.file },
      url: clip(line),
    })),
  ]
}

/** The entry the menu opens on: the first recorded line, else the take. */
export function firstEntry(entries: HearEntry[]): HearEntry {
  return entries[1] ?? entries[0]!
}

/** Seconds as m:ss ("0:07"). */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** What shows beside the control while a line loops: "0:03 / 0:07 · looping". */
export function loopingText(position: number, length: number): string {
  return `${clock(position)} / ${clock(length)} · looping`
}
