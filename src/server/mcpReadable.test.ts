import { describe, expect, it } from 'bun:test'
import { READABLE, matchReadable } from './mcpReadable'

describe('what an agent may read', () => {
  it('matches a route template and takes its query', () => {
    expect(matchReadable('/api/project')?.page).toBe('Setup')
    expect(matchReadable('/api/parts/act1/lines/a/takes')?.kind).toBe('state')
    expect(matchReadable('/api/parts/act1/clips/a.mp3?v=2')?.kind).toBe('file')
    expect(matchReadable('/api/images/castle/takes/3')?.page).toBe('Images')
    expect(matchReadable('/api/effects/door/takes/x.wav')?.page).toBe('Sound effects')
    // A picture, so studio_fetch hands it over.
    expect(matchReadable('/api/images/castle/fine-tunes/base')?.kind).toBe('file')
  })

  it('refuses what is not listed, however it is written', () => {
    for (const path of [
      '/api/nothing',
      '/api/parts',
      '/api/parts/act1/extra/extra',
      '/api/parts/../project',
      '/api/parts/%2e%2e/project',
      '/api/parts/a%2fb',
      '/api/parts/act1/clips/',
      'api/project',
      '/other',
      '//api/project',
      '/api/project#x',
      '',
    ]) {
      expect(matchReadable(path)).toBeNull()
    }
  })

  it('names every page', () => {
    expect([...new Set(READABLE.map((r) => r.page))].sort()).toEqual([
      'Images',
      'Music and Stingers',
      'Narration',
      'Scenes',
      'Setup',
      'Sound effects',
    ])
  })
})
