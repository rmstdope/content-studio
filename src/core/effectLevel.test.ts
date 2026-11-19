import { describe, expect, it } from 'bun:test'
import {
  EFFECT_LEVEL,
  LevelSchema,
  applyLevel,
  cleanLevel,
  levelFailedChosenLine,
  levelFailedOtherLine,
  levelFailedGameChangedLine,
  levelGameLine,
  peakOfWav,
  levelPercent,
  levelTooLoud,
  levelWritingLine,
  tooLoudLine,
} from './effectLevel'
import type { Wav } from './wav'

function mono(values: number[]): Wav {
  return {
    format: { channels: 1, sampleRate: 100, bitsPerSample: 16 },
    data: new Uint8Array(new Int16Array(values).buffer),
  }
}
const read = (wav: Wav) =>
  Array.from(new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.byteLength / 2))

describe('effect level', () => {
  it('accepts 10% to 200% in steps of 5%', () => {
    expect(LevelSchema.safeParse(0.1).success).toBe(true)
    expect(LevelSchema.safeParse(1.4).success).toBe(true)
    expect(LevelSchema.safeParse(2).success).toBe(true)
    expect(LevelSchema.safeParse(0.05).success).toBe(false)
    expect(LevelSchema.safeParse(2.05).success).toBe(false)
    expect(LevelSchema.safeParse(1.02).success).toBe(false)
    expect(EFFECT_LEVEL).toEqual({ min: 0.1, max: 2, step: 0.05 })
  })

  it('applies a level to the samples and cuts what goes past the top flat', () => {
    expect(read(applyLevel(mono([1000, -1000]), 1.5))).toEqual([1500, -1500])
    expect(read(applyLevel(mono([1000, -1000]), 0.5))).toEqual([500, -500])
    expect(read(applyLevel(mono([30000, -30000]), 2))).toEqual([32767, -32768])
  })

  it('leaves the sound as it is at 100%', () => {
    const wav = mono([5, -7])
    expect(applyLevel(wav, 1)).toBe(wav)
  })

  it('finds the highest level that stays clean, in steps of 5%, never below 100%', () => {
    expect(cleanLevel(0.8)).toBe(1.25)
    expect(cleanLevel(1)).toBe(1)
    expect(cleanLevel(0.1)).toBe(2)
    expect(cleanLevel(0)).toBe(2)
    expect(cleanLevel(1)).toBe(1)
  })

  it('measures the loudest sample of a sound', () => {
    expect(peakOfWav(mono([100, -16384, 50]))).toBe(0.5)
    expect(peakOfWav(mono([-32768]))).toBe(1)
    expect(peakOfWav(mono([]))).toBe(0)
  })

  it('does not say what the game plays when it could not be put back', () => {
    expect(
      levelFailedGameChangedLine(2, 'it broke, and the game’s file could not be put back.'),
    ).toBe(
      'The level of Take 2 could not be changed: it broke, and the game’s file could not be put back.',
    )
  })

  it('warns only above 100%, when the loudest part goes past the top', () => {
    expect(levelTooLoud(0.8, 1.25)).toBe(false)
    expect(levelTooLoud(0.8, 1.3)).toBe(true)
    expect(levelTooLoud(1, 0.5)).toBe(false)
    expect(levelTooLoud(1, 1)).toBe(false)
  })

  it('words the level as the acceptance does', () => {
    expect(levelPercent(1.4)).toBe('140%')
    expect(levelPercent(0.15)).toBe('15%')
    expect(levelGameLine(1.4)).toBe('The game plays it at 140%.')
    expect(levelWritingLine(1.4)).toBe('Writing it into the game at 140%…')
    expect(levelFailedChosenLine(2, 'disk full', 1)).toBe(
      'The level of Take 2 could not be changed: disk full. The game still plays it at 100%.',
    )
    expect(levelFailedOtherLine(3, 'disk full')).toBe(
      'The level of Take 3 could not be saved: disk full.',
    )
    expect(tooLoudLine(1.8, 0.8)).toBe(
      'At 180% the loudest parts are cut flat and may sound harsh. Up to 125% stays clean.',
    )
    expect(tooLoudLine(1.5, 1)).toBe(
      'At 150% the loudest parts are cut flat and may sound harsh. Up to 100% stays clean.',
    )
  })
})
