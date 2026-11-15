import { afterEach, describe, expect, it } from 'bun:test'
import { MakeAllRefused, makeAllActions, notStartedLine } from './batchHooks'
import { sendTake } from './takeHooks'

describe('makeAllActions', () => {
  it('asks for Make all and Stop all at the medium’s address, with Stop all named as the medium names it', () => {
    const effects = makeAllActions('stop-all', [409])
    expect(effects.make.request({ ids: ['a'] })).toEqual({
      method: 'POST',
      path: '/make-all',
      body: { ids: ['a'] },
    })
    expect(effects.stop.request()).toEqual({ method: 'POST', path: '/stop-all' })
    expect(makeAllActions('stop', []).stop.request().path).toBe('/stop')
  })

  it('takes Make all’s refusal as an answer always, and Stop all’s only where the medium does', () => {
    expect(makeAllActions('stop', [409]).make.tolerated).toEqual([409])
    expect(makeAllActions('stop', [409]).stop.tolerated).toEqual([409])
    expect(makeAllActions('stop', []).make.tolerated).toEqual([409])
    expect(makeAllActions('stop', []).stop.tolerated).toEqual([])
  })

  describe('sent', () => {
    const original = globalThis.fetch
    const seen: { url: string; init: RequestInit }[] = []
    afterEach(() => {
      globalThis.fetch = original
      seen.length = 0
    })

    it('sends Make all without a body when it has none, and throws what it was doing on a failure', async () => {
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        seen.push({ url, init })
        return Response.json({}, { status: 500 })
      }) as unknown as typeof fetch
      const actions = makeAllActions('stop', [])
      await expect(sendTake('/api/music/lists/a', actions.make, undefined)).rejects.toThrow(
        'asking for takes answered 500',
      )
      expect(seen[0]?.url).toBe('/api/music/lists/a/make-all')
      expect(seen[0]?.init.body).toBeUndefined()
    })
  })
})

describe('notStartedLine', () => {
  it('says the studio’s reason for a refusal, and that the takes could not be started otherwise', () => {
    expect(
      notStartedLine(new MakeAllRefused('No takes were made: b.json could not be written.')),
    ).toBe('No takes were made: b.json could not be written.')
    expect(notStartedLine('Takes of this patch are being made.')).toBe(
      'Takes of this patch are being made.',
    )
    for (const other of [new Error('asking for takes answered 500'), null, undefined]) {
      expect(notStartedLine(other)).toBe(
        'The takes could not be started. Nothing was made; try again.',
      )
    }
  })
})
