import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createFakeEffects } from '../services/effectsFake'
import { startServer } from './index'
import { encode, fish } from './test-support'

const hasFfmpeg = Bun.which('ffmpeg') !== null

describe.skipIf(!hasFfmpeg)('server, a scene’s mix as a sound', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
      scenes: { from: { part: 'tts/{part}/scenes.json' }, mix: 'game/scenes/{part}.mix.json' },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/effects.json': [{ id: 'wind', text: 'Wind', seconds: 1 }],
    'tts/act1/scenes.json': [
      { id: 'hall', title: 'Hall', states: ['calm', 'storm'], triggers: [] },
      { id: 'attic', title: 'Attic', states: [], triggers: [] },
    ],
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
  const origin = studio.url.origin
  const send = (method: string, path: string, body?: unknown) =>
    fetch(new URL(path, studio.url), {
      method,
      headers: { origin, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const get = (path: string) => fetch(new URL(path, studio.url))

  const listing = (dir: string) =>
    (readdirSync(dir, { recursive: true }) as string[]).sort().map((f) => {
      const path = join(dir, f)
      return statSync(path).isFile()
        ? `${f} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`
        : f
    })

  it('says what is wrong before there is a mix to play', async () => {
    expect((await get('/api/scenes/act1/nope/mix')).status).toBe(404)
    expect((await get('/api/scenes/act9/hall/mix')).status).toBe(404)
    const silent = await get('/api/scenes/act1/hall/mix')
    expect(silent.status).toBe(409)
    expect((await silent.json()).message).toContain('hall plays nothing in its calm state')
    const bad = await get('/api/scenes/act1/hall/mix?state=gale')
    expect(bad.status).toBe(400)
    expect((await bad.json()).message).toContain('its states are calm, storm')
    const none = await get('/api/scenes/act1/attic/mix?state=calm')
    expect([none.status, (await none.json()).message]).toEqual([
      400,
      'attic has no states, so none can be asked for',
    ])
  })

  it('renders the saved mix as a minute of WAV, which studio_fetch hands over with its facts', async () => {
    await send('POST', '/api/effects/wind/takes', { count: 1 })
    let file = ''
    for (let i = 0; i < 300 && !file; i++) {
      const v = await (await get('/api/effects/wind/takes')).json()
      if (!v.making.length && v.takes.length) file = v.takes[0].file
      else await new Promise((r) => setTimeout(r, 10))
    }
    expect((await send('POST', '/api/effects/wind/choose', { file })).status).toBe(200)
    const mix = { effects: [{ id: 'wind', play: { mode: 'loop' }, state: 'storm', level: 1 }] }
    expect((await send('PUT', '/api/scenes/act1/hall', { scene: mix, was: null })).status).toBe(200)
    const before = listing(root)

    const calm = await get('/api/scenes/act1/hall/mix')
    expect(calm.status).toBe(409)
    const storm = await get('/api/scenes/act1/hall/mix?state=storm')
    expect([storm.status, storm.headers.get('content-type')]).toEqual([200, 'audio/wav'])
    const wav = new Uint8Array(await storm.arrayBuffer())
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')

    const fetched = await fetchTool('/api/scenes/act1/hall/mix?state=storm')
    expect(fetched.isError).toBeUndefined()
    expect(fetched.content.map((c) => c.type)).toEqual(['text', 'text', 'audio'])
    expect(fetched.content[0]!.text).toContain('audio/wav')
    expect(fetched.content[1]!.text).toMatch(/Duration 60\.\d s, loudness -?\d+\.\d LUFS/)
    expect(listing(root)).toEqual(before)
  })

  async function fetchTool(path: string) {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'studio_fetch', arguments: { path } },
      }),
    })
    return (
      (await response.json()) as {
        result: { isError?: true; content: { type: string; text: string }[] }
      }
    ).result
  }

  it('lists the mix among what an agent can read on the Scenes page', async () => {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'studio_pages', arguments: {} },
      }),
    })
    const text = ((await response.json()) as { result: { content: { text: string }[] } }).result
      .content[0]!.text
    expect(JSON.parse(text).read.Scenes).toContainEqual(
      expect.objectContaining({ path: '/api/scenes/:part/:id/mix', kind: 'file' }),
    )
  })
})
