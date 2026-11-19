import { describe, expect, it } from 'bun:test'
import { CharacterSchema, LockEntrySchema, projectCast, voiceOf } from './resources'
import { LEVEL, isLevel, levelDb, lineLevel } from './level'

describe('a voice level', () => {
  it('is a gain in dB relative to 100%', () => {
    expect(levelDb(100)).toBe(0)
    expect(levelDb(50)).toBeCloseTo(-6.02, 2)
    expect(levelDb(200)).toBeCloseTo(6.02, 2)
  })

  it('runs from 10% to 200% in whole numbers', () => {
    expect([LEVEL.min, LEVEL.max, LEVEL.step, LEVEL.default]).toEqual([10, 200, 5, 100])
    expect([10, 60, 200].every(isLevel)).toBe(true)
    expect([9, 201, 60.5, Number.NaN].some(isLevel)).toBe(false)
  })

  it('reads a clip as 100% when its lock entry has no level', () => {
    expect(lineLevel({})).toBe(100)
    expect(lineLevel({ level: 60 })).toBe(60)
    expect(lineLevel(undefined)).toBe(100)
  })

  it('is kept in the cast per language, and in the lock per clip', () => {
    expect(
      CharacterSchema.safeParse({ level: 60, languages: { sv: { level: 150 } } }).success,
    ).toBe(true)
    expect(CharacterSchema.safeParse({ level: 5 }).success).toBe(false)
    expect(CharacterSchema.safeParse({ languages: { sv: { level: 201 } } }).success).toBe(false)
    const entry = {
      fp: 'f',
      voice: 'v',
      model: 'm',
      hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
      at: 'T',
    }
    expect(LockEntrySchema.safeParse({ ...entry, level: 60 }).success).toBe(true)
    expect(LockEntrySchema.safeParse({ ...entry, level: 0 }).success).toBe(false)
  })

  it('is the voice of a language: the entry’s own, or under languages, 100 when none', () => {
    const entry = { voice: 'a', level: 60, languages: { sv: { voice: 'b', level: 150 } } }
    expect(voiceOf(entry, 'en', 'en').level).toBe(60)
    expect(voiceOf(entry, 'sv', 'en').level).toBe(150)
    expect(voiceOf({ voice: 'a' }, 'en', 'en').level).toBe(100)
    expect(voiceOf(undefined, 'sv', 'en').level).toBe(100)
    const spoken = projectCast({ speakers: { x: entry }, pronounce: {} }, 'sv', 'en')
    expect(spoken.speakers.x?.level).toBe(150)
    expect(
      projectCast({ speakers: { x: { voice: 'a' } }, pronounce: {} }, 'sv', 'en').speakers.x?.level,
    ).toBeUndefined()
  })
})
