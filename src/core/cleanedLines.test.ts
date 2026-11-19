import { describe, expect, it } from 'bun:test'
import { CleanedSchema, isCleaned, originalFile, originalsDir } from './cleanedLines'
import { narrationFile } from './project'

describe('cleaned lines', () => {
  it('reads a record of the lines cleaned and rejects anything else', () => {
    const ok = { k1: { at: '2026-01-01T00:00:00Z', original: 'k1.mp3' } }
    expect(CleanedSchema.safeParse(ok).success).toBe(true)
    expect(CleanedSchema.safeParse({ k1: { at: 1 } }).success).toBe(false)
  })

  it('counts a line as cleaned only while its clip is the one that was cleaned', () => {
    const record = { at: 'T1', original: 'k1.mp3' }
    expect(isCleaned(record, { at: 'T1' })).toBe(true)
    // Recorded again since: the lock's time moved on.
    expect(isCleaned(record, { at: 'T2' })).toBe(false)
    expect(isCleaned(undefined, { at: 'T1' })).toBe(false)
    expect(isCleaned(record, undefined)).toBe(false)
  })

  it('keeps originals in the studio folder, per part and language', () => {
    const project = { languages: ['en', 'sv'] }
    expect(narrationFile(project, 'act1', 'en', 'cleaned')).toBe(
      'content-studio/narration/act1.cleaned.json',
    )
    expect(narrationFile(project, 'act1', 'sv', 'cleaned')).toBe(
      'content-studio/narration/act1.sv.cleaned.json',
    )
    expect(originalsDir(project, 'act1', 'sv')).toBe('content-studio/narration/originals/act1.sv')
    expect(originalFile(project, 'act1', 'en', 'k1')).toBe(
      'content-studio/narration/originals/act1/k1.mp3',
    )
  })
})
