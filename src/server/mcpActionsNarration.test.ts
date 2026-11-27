import { describe, expect, it } from 'bun:test'
import { actionBody, confirmLine, matchAction } from './mcpActions'
import { FishTierBody, JobBody, PronounceBody } from './shared'
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

describe('when a batch asks for confirmation', () => {
  const line = (body: unknown) => confirmLine(matchAction('POST', '/api/parts/act1/jobs')!, body)
  const batch = (orphans: string[], kind?: string) => ({
    ...(kind ? { kind } : {}),
    speaker: null,
    keys: ['a'],
    orphans,
  })

  it('names how many orphaned clips it removes', () => {
    expect(line(batch(['x', 'y', 'z']))).toBe(
      'deletes 3 orphaned clips from the game (their lines left the dialog)',
    )
    expect(line(batch(['x'], 'record'))).toBe(
      'deletes 1 orphaned clip from the game (its line left the dialog)',
    )
  })

  it('asks nothing of a batch that removes none', () => {
    expect(line(batch([]))).toBeNull()
    // Measuring and checking again remove no clip, whatever they list.
    expect(line(batch(['x'], 'measure'))).toBeNull()
    expect(line(batch(['x'], 'check'))).toBeNull()
  })

  it('leaves a body the route refuses to the route', () => {
    for (const body of [undefined, null, 'x', { orphans: ['x'] }, { ...batch(['x']), extra: 1 }]) {
      expect(line(body)).toBeNull()
    }
  })
})

describe('what the bodies of the tier, the pronunciation table and the record job say', () => {
  const body = (method: string, path: string) => actionBody(matchAction(method, path)!) ?? ''
  it('names the Fish tiers', () => {
    const text = body('PATCH', '/api/fish-tier')
    for (const word of ['under-100', '"100"', '1000', 'null']) expect(text).toContain(word)
    expect(FishTierBody.safeParse({ tier: 'under-100' }).success).toBe(true)
  })
  it('describes the pronunciation table as pairs, and the table it replaces', () => {
    const text = body('PATCH', '/api/pronounce')
    for (const word of ['table', 'was', '[word, said]', 'perLanguage']) expect(text).toContain(word)
    expect(PronounceBody.safeParse({ table: [['Mara', 'Mahra']], was: [] }).success).toBe(true)
  })
  it('describes the record job', () => {
    const text = body('POST', '/api/parts/act1/jobs')
    for (const word of [
      'record',
      'measure',
      'check',
      'draft',
      'final',
      'speaker',
      'null',
      'keys',
      'orphans',
    ])
      expect(text).toContain(word)
    expect(
      JobBody.safeParse({ kind: 'check', stage: 'final', speaker: null, keys: [], orphans: [] })
        .success,
    ).toBe(true)
  })
})

describe('what an agent reads of money and of what it read before', () => {
  const body = (method: string, path: string) => actionBody(matchAction(method, path)!) ?? ''
  it('says a confirmed cost is in dollars', () => {
    for (const path of ['/api/parts/act1/jobs', '/api/parts/act1/lines/a/record'])
      expect(body('POST', path)).toContain('confirmedCost is a number 0 or more (dollars)')
    expect(body('POST', '/api/parts/act1/lines/a/takes')).toContain('(dollars)')
  })
  it('says the ElevenLabs settings were as read', () => {
    expect(body('PUT', '/api/elevenlabs/tts')).toContain('(the settings as you read them)')
  })
})

describe('what an agent reads of the five model saves', () => {
  it.each([
    ['/api/image-model', ['"klein"', '"qwen-image"']],
    ['/api/effect-model', ['"small-sfx"', '"open-1"']],
    ['/api/models/draft', ['"s2.1-pro"', '"drama-3"']],
    ['/api/models/elevenlabs/draft', ['"eleven_v3"']],
  ])('%s names its model ids and where was is read', (path, ids) => {
    const body = actionBody(matchAction('PUT', path)!) ?? ''
    for (const word of ['{ model, was }', 'GET /api/models', ...ids]) {
      expect(body).toContain(word)
    }
  })
})
