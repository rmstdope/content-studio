import { z } from 'zod'
import type { Wav } from './wav'

/** The levels a sound effect take can be given: 10% to 200% in steps of 5%, 1 being the take as made. */
export const EFFECT_LEVEL = { min: 0.1, max: 2, step: 0.05 } as const

/** A take's level: a whole number of 5% steps between 10% and 200%. */
export const LevelSchema = z
  .number()
  .finite()
  .min(EFFECT_LEVEL.min)
  .max(EFFECT_LEVEL.max)
  .refine((level) => Math.abs(level * 20 - Math.round(level * 20)) < 1e-6, 'a multiple of 5%')

/** The body of a save of a take's level. */
export const SetEffectLevelBody = z.object({ level: LevelSchema }).strict()

/** A level as the page writes it: "140%". */
export function levelPercent(level: number): string {
  return `${Math.round(level * 100)}%`
}

/**
 * The take with every sample multiplied by `level` and cut flat where it goes past the top, as the
 * game will play it. At 1 the sound is returned as it is.
 */
export function applyLevel(wav: Wav, level: number): Wav {
  if (level === 1) return wav
  if (wav.format.bitsPerSample !== 16) throw new Error('only 16-bit audio can be given a level')
  const { data } = wav
  const samples = new Int16Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length - (data.length % 2)),
  )
  // Int16Array stores by wrapping, so the cut is made here; assigning clamps nothing.
  for (let at = 0; at < samples.length; at++) {
    samples[at] = Math.max(-32768, Math.min(32767, Math.round(samples[at]! * level)))
  }
  return {
    format: wav.format,
    data: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
  }
}

/** The highest level, in steps of 5% and never below 100%, at which the loudest part stays under the top. */
/** `peak` is the loudest sample of the sound, 0 to 1 of the top. */
export function cleanLevel(peak: number): number {
  if (peak <= 0) return EFFECT_LEVEL.max
  // A hair of slack so 0.8 (1.25 exactly) is not lost to rounding.
  const steps = Math.floor((1 / peak) * 20 + 1e-9)
  return Math.min(EFFECT_LEVEL.max, Math.max(1, steps / 20))
}

/** Whether the level makes the loudest parts go past the top; never below 100%. */
export function levelTooLoud(peak: number, level: number): boolean {
  return level > 1 && peak * level > 1 + 1e-9
}

/** The warning under the slider when the level is too loud: how high it can go and stay clean. */
export function tooLoudLine(level: number, peak: number): string {
  return `At ${levelPercent(level)} the loudest parts are cut flat and may sound harsh. Up to ${levelPercent(cleanLevel(peak))} stays clean.`
}

/** The line under the chosen take's slider when its level is not 100%. */
export function levelGameLine(level: number): string {
  return `The game plays it at ${levelPercent(level)}.`
}

/** The line under the chosen take's slider while the game's sound is being written. */
export function levelWritingLine(level: number): string {
  return `Writing it into the game at ${levelPercent(level)}…`
}

/** A reason as the lines put it, without its closing full stop. */
const reasonOf = (reason: string) => reason.replace(/\.$/, '')

/** The red line when the level of the take in the game could not be changed; `gameLevel` is what the game still plays. */
export function levelFailedChosenLine(n: number, reason: string, gameLevel: number): string {
  return `The level of Take ${n} could not be changed: ${reasonOf(reason)}. The game still plays it at ${levelPercent(gameLevel)}.`
}

/** The red line when the level of a take that is not in the game could not be saved. */
export function levelFailedOtherLine(n: number, reason: string): string {
  return `The level of Take ${n} could not be saved: ${reasonOf(reason)}.`
}

/** The red line when the level could not be changed and the game's sound could not be put back: what the game plays is not known. */
export function levelFailedGameChangedLine(n: number, reason: string): string {
  return `The level of Take ${n} could not be changed: ${reasonOf(reason)}.`
}

/** The loudest sample of a sound, 0 to 1 of the top (16-bit audio). */
export function peakOfWav(wav: Wav): number {
  const { data } = wav
  const samples = new Int16Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length - (data.length % 2)),
  )
  let top = 0
  for (const sample of samples) top = Math.max(top, Math.abs(sample))
  return Math.min(1, top / 32768)
}
