import type { Wav } from './wav'

/**
 * The one fixed clean-up of a voice (as-bifl): a high-pass, a noise print learned from the
 * quietest stretch of the take, and a soft gate that lowers the pauses. There is no strength to
 * set; the numbers are what the listening test chose.
 */
export const CLEANUP = {
  /** Everything below this is cut: the noise sits below about 1 kHz, the voice mostly above. */
  highpassHz: 80,
  /** How far the noise print is taken down (afftdn `nr`). */
  reductionDb: 20,
  /** How long the quietest stretch is that the noise is learned from. */
  noiseSeconds: 0.4,
  /** The gate opens this far above the voice's own floor. */
  gateAboveFloorDb: 12,
  /** How far the gate lowers a pause. */
  gateLowersDb: 10,
  /** Changes when the chain does, so cleaned copies kept in the cache are made again. */
  version: 1,
} as const

/** What a take's own noise looks like: where its quietest stretch is and how loud that is. */
export interface Floor {
  /** The loudness of the quietest stretch, in dBFS. */
  db: number
  /** Where that stretch starts, in seconds. */
  start: number
}

/** The level of silence in dBFS, for a stretch with no signal at all. */
const SILENCE = -120

/**
 * The quietest stretch of `seconds` in a 16-bit take (its channels averaged), found by sliding a
 * window of that length over it in steps of a tenth of it, and its RMS level in dBFS. Null for a
 * take shorter than the window or not 16-bit PCM, which has no stretch to learn from.
 */
export function quietestStretch({ format, data }: Wav, seconds: number): Floor | null {
  if (format.bitsPerSample !== 16) return null
  const frames = Math.floor(data.length / (2 * format.channels))
  const window = Math.round(seconds * format.sampleRate)
  if (window < 1 || frames < window) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // The energy of each frame, summed as a running total so each window is a subtraction.
  const energy = new Float64Array(frames + 1)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel++) {
      sum += view.getInt16((frame * format.channels + channel) * 2, true) / 32768
    }
    const mean = sum / format.channels
    energy[frame + 1] = energy[frame]! + mean * mean
  }
  const step = Math.max(1, Math.floor(window / 10))
  let best = { mean: Infinity, at: 0 }
  for (let at = 0; at + window <= frames; at += step) {
    const mean = (energy[at + window]! - energy[at]!) / window
    if (mean < best.mean) best = { mean, at }
  }
  const db = best.mean > 0 ? 10 * Math.log10(best.mean) : SILENCE
  return { db: Math.max(db, SILENCE), start: best.at / format.sampleRate }
}

/** Seconds as ffmpeg reads them, with microsecond precision. */
function time(seconds: number): string {
  return seconds.toFixed(6)
}

/**
 * The ffmpeg `-af` chain that cleans a take whose quietest stretch is `floor`: high-pass, then a
 * noise print learned from that stretch (the `asendcmd` marks it for `afftdn`), then a gate that
 * opens 12 dB above the floor and lowers what stays under it by 10 dB. A take with no floor
 * silent enough to tell from the voice is still gated at least above the level of digital silence.
 */
export function cleanupFilter(floor: Floor): string {
  const { highpassHz, reductionDb, noiseSeconds, gateAboveFloorDb, gateLowersDb } = CLEANUP
  const threshold = 10 ** (Math.min(floor.db + gateAboveFloorDb, -6) / 20)
  const range = 10 ** (-gateLowersDb / 20)
  return [
    `highpass=f=${highpassHz}`,
    `asendcmd=c='${time(floor.start)} afftdn sn start; ${time(floor.start + noiseSeconds)} afftdn sn stop'`,
    `afftdn=nr=${reductionDb}`,
    `agate=threshold=${threshold.toFixed(6)}:range=${range.toFixed(6)}`,
  ].join(',')
}
