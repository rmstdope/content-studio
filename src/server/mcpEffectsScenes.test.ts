import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createFakeEffects } from '../services/effectsFake'
import { startServer } from './index'
import { encode, fish } from './test-support'

/** What a tool call answers, as far as these tests look. */
interface Called {
  isError?: true
  content: { type: string; text: string }[]
}

describe('an agent doing the Sound effects and Scenes steps through the MCP', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      refresh: { shared: `cp tts/more.json tts/effects.json` },
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
      scenes: { from: { part: 'tts/{part}/scenes.json' }, mix: 'game/scenes/{part}.mix.json' },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/effects.json': [
      { id: 'coins', text: 'Coins spill on stone', seconds: 0.5 },
      { id: 'door', text: 'A door creaks', seconds: 3 },
    ],
    'tts/more.json': [
      { id: 'coins', text: 'Coins spill on stone', seconds: 0.5 },
      { id: 'door', text: 'A door creaks', seconds: 3 },
      { id: 'bell', text: 'A bell rings', seconds: 2 },
    ],
    'tts/act1/scenes.json': [{ id: 'store', title: 'Store', states: [], triggers: [] }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    effects: createFakeEffects(5),
  })
  afterAll(() => studio.stop(true))

  let id = 0
  const act = async (args: Record<string, unknown>): Promise<Called> => {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name: 'studio_act', arguments: args },
      }),
    })
    return ((await response.json()) as { result: Called }).result
  }
  const text = (c: Called) => c.content[0]!.text
  const read = async (path: string) => (await fetch(new URL(path, studio.url))).json()
  const settled = async (effect: string) => {
    for (let i = 0; i < 200; i++) {
      const v = await read(`/api/effects/${effect}/takes`)
      if (!v.making.length) return v
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('never finished')
  }
  const listing = (dir: string) =>
    (readdirSync(dir, { recursive: true }) as string[]).sort().map((f) => {
      const path = join(dir, f)
      return statSync(path).isFile()
        ? `${f} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`
        : f
    })

  it('refreshes the list, describes an effect, makes takes, chooses and adjusts one', async () => {
    const refreshed = await act({ method: 'POST', path: '/api/effects/refresh' })
    expect(refreshed.isError).toBeUndefined()
    expect(
      (await read('/api/project')).summary.effects.rows.map((r: { id: string }) => r.id),
    ).toContain('bell')
    const described = await act({
      method: 'PATCH',
      path: '/api/effects/coins',
      body: { description: 'Coins on glass' },
    })
    expect(described.isError).toBeUndefined()
    expect(
      (await read('/api/project')).summary.effects.rows.find(
        (r: { id: string }) => r.id === 'coins',
      ),
    ).toMatchObject({ description: 'Coins on glass' })

    await act({ method: 'POST', path: '/api/effects/door/takes', body: { count: 2 } })
    const made = await settled('door')
    const file = made.takes[0].file as string
    const fades = { in: 0.1, out: 0.2, shape: 'straight' }
    expect(
      (await act({ method: 'PUT', path: `/api/effects/door/takes/${file}/fades`, body: fades }))
        .isError,
    ).toBeUndefined()
    expect(
      (await act({ method: 'POST', path: '/api/effects/door/choose', body: { file } })).isError,
    ).toBeUndefined()
    expect((await read('/api/effects/door/takes')).takes[0].fades).toEqual(fades)
  })

  it('does not forget, un-choose, drop or make all without the user’s confirmation', async () => {
    const before = listing(root)
    const file = (await read('/api/effects/door/takes')).takes[1].file as string
    for (const args of [
      { method: 'POST', path: '/api/effects/door/forget' },
      { method: 'POST', path: '/api/effects/door/unchoose' },
      { method: 'DELETE', path: `/api/effects/door/takes/${file}` },
      { method: 'POST', path: '/api/effects/make-all', body: { ids: ['bell'] } },
    ]) {
      const answer = await act(args)
      expect(answer.isError).toBe(true)
      expect(text(answer)).toContain('confirmation')
    }
    expect(listing(root)).toEqual(before)
  })

  it('does them once confirmed, and a refusal comes back as an error with the reason', async () => {
    const file = (await read('/api/effects/door/takes')).takes[1].file as string
    expect(
      (await act({ method: 'DELETE', path: `/api/effects/door/takes/${file}`, confirmed: true }))
        .isError,
    ).toBeUndefined()
    expect((await read('/api/effects/door/takes')).takes.length).toBe(1)
    expect(
      (await act({ method: 'POST', path: '/api/effects/door/unchoose', confirmed: true })).isError,
    ).toBeUndefined()
    const missing = await act({ method: 'POST', path: '/api/effects/nope/forget', confirmed: true })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('404')
  })

  it('makes all with confirmation', async () => {
    const answer = await act({
      method: 'POST',
      path: '/api/effects/make-all',
      body: { ids: ['bell'] },
      confirmed: true,
    })
    expect(answer.isError).toBeUndefined()
    expect((await settled('bell')).takes.length).toBeGreaterThan(0)
  })

  it('reaches the other steps through the same routes', async () => {
    const file = (await read('/api/effects/door/takes')).takes[0].file as string
    const reached = async (args: Record<string, unknown>) => {
      const answer = await act(args)
      expect(text(answer)).not.toContain('Not something to do')
      return answer
    }
    expect(
      (await reached({ method: 'POST', path: '/api/effects/coins/keep-mine' })).isError,
    ).toBeUndefined()
    expect(
      (
        await reached({
          method: 'PUT',
          path: `/api/effects/door/takes/${file}/level`,
          body: { level: 1.4 },
        })
      ).isError,
    ).toBeUndefined()
    await reached({ method: 'DELETE', path: `/api/effects/door/takes/${file}/fades` })
    await reached({ method: 'POST', path: '/api/effects/door/trim', body: { file } })
    await reached({ method: 'POST', path: '/api/effects/door/accept' })
    await reached({ method: 'POST', path: '/api/effects/door/stop' })
    await reached({ method: 'POST', path: '/api/effects/batch/close' })
    await reached({ method: 'POST', path: '/api/effects/stop-all' })
  })

  it('measures a part’s loudness with the empty body the page sends', async () => {
    const measured = await act({ method: 'POST', path: '/api/scene-loudness/act1', body: {} })
    expect(text(measured)).not.toContain('Not something to do')
    expect(text(measured)).not.toContain('400')
    const unknown = await act({ method: 'POST', path: '/api/scene-loudness/nope', body: {} })
    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain('404')
  })

  it('saves a scene’s mix', async () => {
    const mix = { music: { track: null, level: 1 }, effects: [] }
    expect(
      (
        await act({
          method: 'PUT',
          path: '/api/scenes/act1/store',
          body: { scene: mix, was: null },
        })
      ).isError,
    ).toBeUndefined()
    expect(
      JSON.parse(readFileSync(join(root, 'game/scenes/act1.mix.json'), 'utf8')).scenes.store,
    ).toEqual(mix)
    const stale = await act({
      method: 'PUT',
      path: '/api/scenes/act1/store',
      body: { scene: mix, was: null },
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('409')
  })

  it('refuses a change that is not a step of those pages', async () => {
    const answer = await act({ method: 'PUT', path: '/api/effects/door/choose', body: {} })
    expect(answer.isError).toBe(true)
  })
})
