/**
 * A voice's level (as-ohm7): how loud its lines play next to the others, as a percentage of the
 * loudness every line is levelled to. 100 is the clip as it is levelled today.
 */
export const LEVEL = { min: 10, max: 200, step: 5, default: 100 } as const

/** Whether `value` is a level the studio saves: a whole number from 10 to 200. */
export function isLevel(value: number): boolean {
  return Number.isInteger(value) && value >= LEVEL.min && value <= LEVEL.max
}

/** The gain, in dB, that takes a clip at 100% to `level`: 50% is about −6 dB, 200% about +6 dB. */
export function levelDb(level: number): number {
  return 20 * Math.log10(level / 100)
}

/** The level a clip is at: its lock entry's `level`, 100 when it has none. */
export function lineLevel(entry: { level?: number } | undefined): number {
  return entry?.level ?? LEVEL.default
}

/** What setting a level says while the voice's lines are being cleaned or put back; the page waits on it. */
export const LEVEL_WAIT = 'Wait for the lines to finish being cleaned.'

/**
 * What is said of a line whose clip could not be set or cleaned: the line, then a plain reason. A
 * tool's words about a hidden temporary file (a path) are never shown, only that the clip could not
 * be read; a clip that is gone is "missing from the clips folder".
 */
export function lineFailure(key: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ENOENT') return `Line ${key}: the clip is missing from the clips folder.`
  if (/\.(mp3|wav|ogg)\b/.test(message) || /[\\/]/.test(message)) {
    return `Line ${key}: the clip could not be read.`
  }
  return `Line ${key}: ${message}`
}
