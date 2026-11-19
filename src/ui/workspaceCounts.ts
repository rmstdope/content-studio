import { imagesDone } from '../core/images'
import { tracksDone } from '../core/musicChoose'
import type { PartSummary, ProjectSummary } from '../core/summary'
import type { PartProgress } from '../services/workspace'
import { shortTitle } from './format'
import { actCount, doneCount, type DoneTone } from './sidebarActs'
import { railDot } from './sidebarFold'

/** A workspace's done count over the whole game, as its sidebar row and its rail icon show it. */
export interface WorkspaceCount {
  /** The row's count ("2880/2881"). */
  text: string
  tone: DoneTone
  /** Some act could not be read and is left out of the sum. */
  warn: boolean
  /** The row's hover: what is counted, then a line per act left out. */
  tip: string
  /** The folded icon's hover. */
  railTip: string
  /** The folded icon's dot. */
  dot: 'all' | 'some' | 'none'
}

/** Adds up what can be read; nothing when no act could be, or when some part is not known yet. */
function total(
  done: number,
  all: number,
  readable: number,
  leftOut: string[],
  what: string,
  rail: (text: string) => string,
): WorkspaceCount | null {
  if (readable === 0 && leftOut.length > 0) return null
  const count = doneCount({ done, total: all })
  return {
    text: count.text,
    tone: count.tone,
    warn: leftOut.length > 0,
    tip: [what, ...leftOut].join('\n'),
    railTip: rail(count.text),
    dot: railDot(done, all),
  }
}

/**
 * Narration's lines that are ok out of all, over every act in the language shown (`language` is
 * its name); nothing until `progress` is known, and an act it cannot read is left out.
 */
export function narrationCount(
  parts: Pick<PartSummary, 'id' | 'title' | 'dialog' | 'lineCount'>[],
  progress: Record<string, PartProgress> | undefined,
  language: string,
): WorkspaceCount | null {
  if (!progress) return null
  let ok = 0
  let lines = 0
  let readable = 0
  const leftOut: string[] = []
  for (const part of parts) {
    const p = progress[part.id]
    if (part.dialog === 'ok' && p) {
      ok += p.ok
      lines += p.lines
      readable++
    } else {
      const reason = part.dialog === 'ok' ? 'invalid' : actCount(part).text
      leftOut.push(`${shortTitle(part.title)} left out: ${reason}`)
    }
  }
  return total(
    ok,
    lines,
    readable,
    leftOut,
    `Lines that are ok in ${language}, out of all, in every act`,
    (text) => `Narration · ${text} lines ok`,
  )
}

/** The reason word of a list that cannot be read. */
function unreadable(state: string): string {
  return state === 'missing' ? 'no list' : 'invalid'
}

/** Music's tracks done out of all, over every act and the Stingers; nothing without a music section. */
export function musicCount(music: ProjectSummary['music']): WorkspaceCount | null {
  if (!music) return null
  let done = 0
  let all = 0
  let readable = 0
  const leftOut: string[] = []
  for (const list of music.lists) {
    if (list.state === 'ok') {
      const d = tracksDone(list.tracks)
      done += d.done
      all += d.total
      readable++
    } else {
      const name = list.kind === 'stingers' ? 'Stingers' : shortTitle(list.title)
      leftOut.push(`${name} left out: ${unreadable(list.state)}`)
    }
  }
  return total(
    done,
    all,
    readable,
    leftOut,
    'Tracks with a take chosen and up to date, out of all, in every act and the Stingers',
    (text) => `Music · ${text} tracks done`,
  )
}

/** Images finished out of all, over every act; nothing without an images section. */
export function imagesCount(images: ProjectSummary['images']): WorkspaceCount | null {
  if (!images) return null
  let done = 0
  let all = 0
  let readable = 0
  const leftOut: string[] = []
  for (const act of images.acts) {
    if (act.state === 'ok') {
      const d = imagesDone(act)
      done += d.done
      all += d.total
      readable++
    } else {
      leftOut.push(`${shortTitle(act.title)} left out: ${unreadable(act.state)}`)
    }
  }
  return total(
    done,
    all,
    readable,
    leftOut,
    'Images finished, out of all, in every act',
    (text) => `Images · ${text} images finished`,
  )
}

/** Sound effects' count as the folded rail shows it; the unfolded row keeps its own. */
export function effectsCount(effects: ProjectSummary['effects']): WorkspaceCount | null {
  if (effects?.status !== 'ok') return null
  const count = doneCount(effects.done)
  return {
    text: count.text,
    tone: count.tone,
    warn: false,
    tip: 'Sound effects with a take chosen and up to date, out of all',
    railTip: `Sound effects · ${count.text} sound effects done`,
    dot: railDot(effects.done.done, effects.done.total),
  }
}
