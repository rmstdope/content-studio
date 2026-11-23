import { describe, expect, it } from 'bun:test'
import { matchAction } from './mcpActions'
import { SETUP_AND_NARRATION_ACTIONS } from './mcpActionsNarration'

describe('what an agent may do on Setup and Narration', () => {
  it('matches a method and a route template, with its query', () => {
    expect(matchAction('PATCH', '/api/take-fade')?.page).toBe('Setup')
    expect(matchAction('POST', '/api/parts/act1/lines/a/record?language=sv')?.page).toBe(
      'Narration',
    )
    expect(matchAction('DELETE', '/api/auditions/mara')?.confirm).toBeString()
  })

  it('refuses the wrong method and what is not listed, however it is written', () => {
    expect(matchAction('GET', '/api/take-fade')).toBeNull()
    expect(matchAction('POST', '/api/take-fade')).toBeNull()
    expect(matchAction('POST', '/api/nothing/castle')).toBeNull()
    for (const path of [
      '/api/parts/../take-fade',
      '/api/parts/%2e%2e/adopt',
      '/api/parts/a%2fb/adopt',
      '/api/parts/act1/adopt#x',
      '/api/auditions/.\t/sitting',
      '/api/auditions/.\n/sitting',
      '/api/auditions/.\r./sitting',
      '/api/auditions/a b/sitting',
      'api/take-fade',
      '//api/take-fade',
      '',
    ]) {
      expect(matchAction('POST', path)).toBeNull()
      expect(matchAction('PATCH', path)).toBeNull()
    }
  })

  it('asks for confirmation wherever the web UI does', () => {
    for (const [method, path] of [
      ['DELETE', '/api/parts/a/lines/k/takes/f.wav'],
      ['POST', '/api/characters/mara/cleaned-lines/clean'],
      ['POST', '/api/characters/mara/cleaned-lines/put-back'],
      ['POST', '/api/characters/mara/level'],
      ['POST', '/api/elevenlabs/voices/free'],
      ['DELETE', '/api/characters/mara/ruled-out'],
      ['POST', '/api/auditions/mara/cast'],
      ['POST', '/api/characters/mara/cast-voice'],
      ['PUT', '/api/models/draft'],
      ['PUT', '/api/models/elevenlabs/final'],
      ['PUT', '/api/elevenlabs/tts'],
      ['PATCH', '/api/models'],
    ] as const) {
      expect(matchAction(method, path)?.confirm).toBeString()
    }
    expect(matchAction('PATCH', '/api/take-fade')?.confirm).toBeUndefined()
  })

  it('lists each method and route once', () => {
    const keys = SETUP_AND_NARRATION_ACTIONS.map((a) => `${a.method} ${a.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
