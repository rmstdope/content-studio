/** "line" or "lines" for a count. */
const lines = (n: number) => (n === 1 ? 'line' : 'lines')

/** The line under the slider once it differs from the saved level. */
export function unsetText(saved: number): string {
  return `Not set yet — this voice plays at ${saved}%.`
}

/** The heading of the question before the lines in the game are rewritten. */
export function askLevelTitle(level: number): string {
  return `Set this voice to ${level}%?`
}

/** The notes of the question: what is rewritten, what is new, and how to undo (not when setting 100%). */
export function askLevelNotes(level: number, total: number): string[] {
  return [
    `The ${total} ${lines(total)} in the game ${total === 1 ? 'is' : 'are'} rewritten at ${level}%.`,
    `New lines are recorded at ${level}%.`,
    ...(level === 100 ? [] : ['Setting it back to 100% puts them back as they are now.']),
  ]
}

/** The progress line while the lines in the game are rewritten. */
export function rewritingText(level: number, done: number, total: number): string {
  return `Setting lines in the game to ${level}%… ${done} of ${total}`
}

/** What is said when some lines in the game are not at the level: how many and where they are. */
export function behindText(n: number, old: number): string {
  return `${n} ${lines(n)} in the game ${n === 1 ? 'is' : 'are'} still at ${old}%.`
}

/** Under the "still at" line after some lines could not be set: how many, and the first reason as given. */
export function couldntSetText(n: number, level: number, reason: string): string {
  return `${n} ${lines(n)} couldn’t be set to ${level}%: ${reason}`
}

/** When the level could not be saved. */
export function levelCouldntSaveText(reason: string): string {
  return `Couldn’t save the level: ${reason}`
}

/** The note under the slider above 100%. */
export const SOFTENED = 'Above 100%, the loudest moments are softened so they don’t crackle.'

/** The hint under the label. */
export const LEVEL_HINT =
  'How loud this voice plays next to the others. 100% is the loudness every line is levelled to.'

/**
 * The gain to hear a file at when the slider is at `slider` percent and the file already carries
 * `carries` percent (a game clip its voice's level; the take, and an original, 100).
 */
export function hearGain(slider: number, carries: number): number {
  return slider / carries
}
