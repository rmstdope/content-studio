import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canRefuseWrites, projectJson, refusingWrites, tempRepo } from '../../test/helpers'
import { writeWav } from '../core/wav'
import { startServer } from './index'
import { encode, fish } from './test-support'

/** What a tool call answers, as far as these tests look. */
interface Result {
  isError?: true
  content: { type: string; text: string }[]
}

/** Every file under a folder with its size and time, to see that nothing was written. */
function snapshot(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).sort().map((f) => {
    const s = statSync(join(dir, f))
    return `${f} ${s.size} ${s.mtimeMs}`
  })
}

describe('an agent doing the Music and Stingers steps', () => {
  const musicRoot = tempRepo({
    'content-studio.json': projectJson({
      refresh: {
        part: 'touch refreshed-{part} tts/{part}/script.json',
        shared: `mkdir -p tts && printf '%s' '[{"id":"victory","title":"Victory","text":"fanfare","seconds":5}]' > tts/stingers.json`,
      },
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
  })
  const studio = startServer({
    projectFile: join(musicRoot, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        const samples = new Int16Array(request.seconds * 1000).fill(4000)
        const format = { channels: 1, sampleRate: 1000, bitsPerSample: 16 }
        return {
          wav: writeWav({ format, data: new Uint8Array(samples.buffer) }),
          seed: request.seed,
        }
      },
      close() {},
    },
  })
  afterAll(() => studio.stop(true))
  let id = 0
  const call = async (name: string, args: unknown): Promise<Result> => {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    return ((await response.json()) as { result: Result }).result
  }
  const mcp = { call }
  const change = (method: string, path: string, body?: unknown, confirmed?: boolean) =>
    mcp.call('studio_act', { method, path, body, confirmed })
  const clip = join(musicRoot, 'audio/music/hall.mp3')
  const takes = async () => {
    let view = JSON.parse(
      (await mcp.call('studio_read', { path: '/api/music/tracks/hall/takes' })).content[0]!.text,
    )
    for (let i = 0; i < 300 && (view.making.length || !view.takes.length); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      view = JSON.parse(
        (await mcp.call('studio_read', { path: '/api/music/tracks/hall/takes' })).content[0]!.text,
      )
    }
    return view
  }

  it('lists the changes with the page, and which ask first', async () => {
    const pages = JSON.parse((await mcp.call('studio_pages', {})).content[0]!.text)
    const entries = pages.actions['Music and Stingers']
    expect(entries.find((c: { path: string }) => c.path.endsWith('/unchoose')).confirm).toBeTruthy()
    expect(
      entries.find((c: { path: string }) => c.path.endsWith('/choose')).confirm,
    ).toBeUndefined()
  })

  it('refuses what is not listed, nothing sent', async () => {
    for (const [method, path] of [
      ['GET', '/api/music/tracks/hall'],
      ['DELETE', '/api/music/tracks/hall/choose'],
      ['POST', '/api/music/tracks/../x/choose'],
      ['POST', '/api/narration/anything'],
    ] as const) {
      const result = await change(method, path, {})
      expect(result.isError).toBe(true)
    }
  })

  it('changes a brief, makes takes, chooses and refreshes, as the page would', async () => {
    const refresh = await change('POST', '/api/music/stingers/refresh')
    expect(refresh.isError).toBeUndefined()
    expect(JSON.parse(refresh.content[0]!.text)).toMatchObject({ ok: true, stingers: 1 })
    const edits = () => readFileSync(join(musicRoot, 'content-studio/music/edits.json'), 'utf8')
    const brief = await change('PATCH', '/api/music/tracks/hall', { bpm: 90 })
    expect(brief.isError).toBeUndefined()
    expect(edits()).toContain('90')
    expect((await change('PATCH', '/api/music/tracks/hall', { bpm: 1000 })).isError).toBe(true)
    await change('POST', '/api/music/tracks/hall/takes', { count: 1 })
    const view = await takes()
    const file = view.takes[0].file
    expect(
      (await change('POST', '/api/music/tracks/hall/choose', { file })).isError,
    ).toBeUndefined()
    expect(existsSync(clip)).toBe(true)
    // Confirmed, the take the game plays is still refused by the route.
    const chosen = await change('DELETE', `/api/music/tracks/hall/takes/${file}`, undefined, true)
    expect(chosen.content[0]!.text).toContain('That take is the one in the game')
  })

  it('does the other steps of a track and a list', async () => {
    const file = (await takes()).takes[0].file
    const fades = { in: 0.5, out: 0.5, shape: 'smooth' }
    for (const [method, path, body] of [
      ['PUT', `/api/music/tracks/hall/takes/${file}/fades`, fades],
      ['DELETE', `/api/music/tracks/hall/takes/${file}/fades`, undefined],
      ['POST', '/api/music/tracks/hall/trim', { file }],
      ['POST', '/api/music/tracks/hall/trim', { file, undo: true }],
      ['POST', '/api/music/tracks/hall/keep-mine', undefined],
      ['POST', '/api/music/tracks/hall/stop', undefined],
      ['POST', '/api/music/lists/act1/batch/close', undefined],
      ['POST', '/api/music/lists/act1/stop', undefined],
    ] as const) {
      const result = await change(method, path, body)
      // A step the page can refuse (nothing to keep, no batch) answers its own 4xx, never "not listed".
      expect(result.content[0]!.text).not.toContain('Not something to do')
    }
    expect((await change('POST', '/api/music/lists/act1/make-all')).content[0]!.text).not.toContain(
      'Not something to do',
    )
    const refreshed = await change('POST', '/api/parts/act1/refresh')
    expect(refreshed.isError).toBeUndefined()
    expect(existsSync(join(musicRoot, 'refreshed-act1'))).toBe(true)
  })

  it('drops an unchosen take only once the user has agreed', async () => {
    await change('POST', '/api/music/tracks/hall/takes', { count: 1, model: 'quick' })
    const view = await takes()
    const spare = view.takes.find((t: { n: number }) => t.n !== view.chosen.take)
    expect(spare).toBeDefined()
    const path = `/api/music/tracks/hall/takes/${spare.file}`
    const before = snapshot(musicRoot)
    const asked = await change('DELETE', path)
    expect(asked.isError).toBe(true)
    expect(asked.content[0]!.text).toBe(
      "Needs the user's confirmation first: this deletes this take's music from the studio. Once the user has agreed, call again with confirmed: true.",
    )
    expect(snapshot(musicRoot)).toEqual(before)
    expect((await change('DELETE', path, undefined, true)).isError).toBeUndefined()
    const after = await takes()
    expect(after.takes.map((t: { file: string }) => t.file)).not.toContain(spare.file)
  })

  it('asks before spending credit on the paid model, and sends nothing', async () => {
    const before = snapshot(musicRoot)
    const project = readFileSync(join(musicRoot, 'content-studio.json'), 'utf8')
    for (const [method, path, body] of [
      ['POST', '/api/music/tracks/hall/takes', { count: 2, model: 'eleven' }],
    ] as const) {
      const asked = await change(method, path, body)
      expect(asked.isError).toBe(true)
      expect(asked.content[0]!.text).toMatch(/ElevenLabs credit.*confirmed: true/)
    }
    expect(snapshot(musicRoot)).toEqual(before)
    expect(readFileSync(join(musicRoot, 'content-studio.json'), 'utf8')).toBe(project)
    // A free model needs no question.
    const free = await change('POST', '/api/music/tracks/hall/takes', { count: 1, model: 'quick' })
    expect(free.content[0]!.text).not.toContain('confirmed: true')
    await takes()
  })

  it('asks before taking the music out of the game, and does nothing until it is confirmed', async () => {
    const before = snapshot(musicRoot)
    const asked = await change('POST', '/api/music/tracks/hall/unchoose', {})
    expect(asked.isError).toBe(true)
    expect(asked.content[0]!.text).toContain('confirmed: true')
    expect(snapshot(musicRoot)).toEqual(before)
    expect(existsSync(clip)).toBe(true)
    const done = await change('POST', '/api/music/tracks/hall/unchoose', {}, true)
    expect(done.isError).toBeUndefined()
    expect(existsSync(clip)).toBe(false)
    expect(readFileSync(join(musicRoot, 'audio/music/manifest.json'), 'utf8')).not.toContain('hall')
  })

  it('asks before removing a track, and does it once confirmed', async () => {
    const path = '/api/music/tracks/gone/remove'
    const before = snapshot(musicRoot)
    const asked = await change('POST', path, {})
    expect(asked.isError).toBe(true)
    expect(asked.content[0]!.text).toContain('confirmed: true')
    expect(snapshot(musicRoot)).toEqual(before)
    // Confirmed, it reaches the page's own route, which answers for a track that is not there.
    const done = await change('POST', path, {}, true)
    expect(done.isError).toBe(true)
    expect(done.content[0]!.text).toMatch(/^404 /)
  })

  it('moves a take as the page does, with no question', async () => {
    const result = await change('POST', '/api/music/tracks/hall/move', {
      file: 'x.1.wav',
      to: 'victory',
    })
    expect(result.content[0]!.text).not.toContain('confirmed: true')
  })

  it('answers 415 to a request that is not JSON', async () => {
    const response = await fetch(new URL('/mcp', studio.url), { method: 'POST', body: '{}' })
    expect(response.status).toBe(415)
  })
})

describe('an agent making music on a paid project model', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      music: {
        model: 'eleven',
        from: { part: 'tts/{part}/music.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    // A key is there and the model ready, so only the question stands before a take.
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate() {
        throw new Error('nothing here is confirmed')
      },
      close() {},
    },
  })
  afterAll(() => studio.stop(true))
  const act = async (args: Record<string, unknown>): Promise<Result> => {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'studio_act', arguments: args },
      }),
    })
    return ((await response.json()) as { result: Result }).result
  }

  it('asks before Make all, a body naming a free model changing nothing, and sends nothing', async () => {
    const before = snapshot(root)
    for (const body of [undefined, { model: 'quick' }]) {
      const asked = await act({ method: 'POST', path: '/api/music/lists/act1/make-all', body })
      expect(asked.isError).toBe(true)
      expect(asked.content[0]!.text).toMatch(
        /ElevenLabs credit \(\$[\d.]+ a minute\).*confirmed: true/,
      )
    }
    expect(snapshot(root)).toEqual(before)
  })

  it('asks before new takes without a model', async () => {
    const before = snapshot(root)
    const asked = await act({
      method: 'POST',
      path: '/api/music/tracks/hall/takes',
      body: { count: 1 },
    })
    expect(asked.isError).toBe(true)
    expect(asked.content[0]!.text).toContain('confirmed: true')
    expect(snapshot(root)).toEqual(before)
  })
})

describe.each([
  ['eleven', true],
  ['quick', false],
] as const)('an agent retrying a music take on the %s model', (model, paid) => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      music: {
        model,
        from: { part: 'tts/{part}/music.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    music: {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate() {
        throw new Error('the generator broke')
      },
      close() {},
    },
  })
  afterAll(() => studio.stop(true))
  const call = async (name: string, args: unknown): Promise<Result> => {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    return ((await response.json()) as { result: Result }).result
  }
  const path = '/api/music/tracks/hall/takes'
  const retry = (n: number, confirmed?: boolean) =>
    call('studio_act', { method: 'POST', path, body: { retry: n }, confirmed })

  // For the paid model the table of refusals below holds these two.
  if (!paid) {
    it('says there is no failed take, and asks nothing, for a take that did not fail', async () => {
      const answer = await retry(9)
      expect(answer.isError).toBe(true)
      expect(answer.content[0]!.text).toBe(
        '409 {"ok":false,"message":"Take 9 did not fail, so it is not made again."}',
      )
    })

    it('says there is no such track, and asks nothing, for a track the studio does not know', async () => {
      for (const body of [{ retry: 1 }, { count: 1 }]) {
        const answer = await call('studio_act', {
          method: 'POST',
          path: '/api/music/tracks/nope/takes',
          body,
        })
        expect(answer.isError).toBe(true)
        expect(answer.content[0]!.text).toBe('404 {"error":"There is no track nope."}')
      }
    })
  }

  it('still treats a take that failed as a retry, asking only when it is paid', async () => {
    await call('studio_act', { method: 'POST', path, body: { count: 1 }, confirmed: true })
    let n: number | undefined
    for (let i = 0; i < 300 && n === undefined; i++) {
      const view = JSON.parse((await call('studio_read', { path })).content[0]!.text)
      n = view.failed[0]?.n
      if (n === undefined) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(n).toBeDefined()
    const answer = await retry(n!)
    if (paid) {
      expect(answer.isError).toBe(true)
      expect(answer.content[0]!.text).toMatch(/ElevenLabs credit.*confirmed: true/)
    } else {
      expect(answer.content[0]!.text).not.toContain('confirmed: true')
      expect(answer.content[0]!.text).not.toContain('did not fail')
    }
  })
})

/**
 * Every refusal the music routes give before spending: studio_act gives it as the route does,
 * asking nothing. Each case sets the project up, so the route itself spends nothing here either.
 */
describe('an agent met by a refusal on a paid project model', () => {
  const lists = {
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 30 }],
    'content-studio/narration/cast.json': { speakers: {} },
  }
  const project = projectJson({
    music: {
      model: 'eleven',
      from: { part: 'tts/{part}/music.json' },
      clips: 'audio/music',
      manifest: 'audio/music/manifest.json',
    },
  })

  /** A studio on its own copy of the project, with a generator that has or lacks what it is told. */
  function start(
    files: Record<string, unknown> = {},
    { installed = true, ready = true }: { installed?: boolean; ready?: boolean } = {},
  ) {
    const root = tempRepo({ 'content-studio.json': project, ...lists, ...files })
    let generated = 0
    const studio = startServer({
      projectFile: join(root, 'content-studio.json'),
      port: 0,
      fish,
      encode,
      transcriber: null,
      music: {
        ready: () => (ready ? { ok: true } : { ok: false, message: 'Not now.', fix: 'wait' }),
        installed: () => installed,
        async generate() {
          generated++
          throw new Error('nothing here may be made')
        },
        close() {},
      },
    })
    const post = async (path: string, body: unknown) => {
      const response = await fetch(new URL(path, studio.url), {
        method: 'POST',
        headers: { origin: studio.url.origin, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return `${response.status} ${await response.text()}`
    }
    const act = async (path: string, body: unknown): Promise<Result> => {
      const response = await fetch(new URL('/mcp', studio.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'studio_act', arguments: { method: 'POST', path, body } },
        }),
      })
      return ((await response.json()) as { result: Result }).result
    }
    return { root, studio, post, act, generated: () => generated }
  }

  const takes = '/api/music/tracks/hall/takes'
  const makeAll = '/api/music/lists/act1/make-all'
  const brokenBoard = { 'content-studio/cache/music/hall.json': '{ not json' }
  const brokenProject = { 'content-studio.json': '{ not json' }
  const long = {
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 900 }],
  }
  type Case = [string, string, unknown, Parameters<typeof start>]
  const cases: Case[] = [
    ['a body that does not fit', takes, { count: 100 }, []],
    ['a broken project file', takes, { count: 1 }, [brokenProject]],
    ['a track too long for the model', takes, { count: 1 }, [long]],
    ['no key', takes, { count: 1 }, [{}, { installed: false }]],
    ['a model not ready', takes, { count: 1 }, [{}, { ready: false }]],
    ['a retry of a take that did not fail', takes, { retry: 3 }, []],
    ['a broken board', takes, { count: 1 }, [brokenBoard]],
    ['Make all with a broken project file', makeAll, undefined, [brokenProject]],
    ['Make all with no key', makeAll, undefined, [{}, { installed: false }]],
    ['Make all with a model not ready', makeAll, undefined, [{}, { ready: false }]],
    ['Make all with a broken board', makeAll, undefined, [brokenBoard]],
  ]

  /** The refusal studio_act gave, held to the route's own, with nothing asked, made or written. */
  async function same(s: ReturnType<typeof start>, path: string, body: unknown) {
    const before = snapshot(s.root)
    const asked = await s.act(path, body)
    expect(snapshot(s.root)).toEqual(before)
    const refusal = await s.post(path, body)
    expect(refusal).toMatch(/^4\d\d /)
    expect(asked.isError).toBe(true)
    expect(asked.content[0]!.text).toBe(refusal)
    expect(s.generated()).toBe(0)
  }

  it.each(cases)('gives the route’s refusal for %s', async (_, path, body, setup) => {
    const s = start(...setup)
    try {
      await same(s, path, body)
    } finally {
      s.studio.stop(true)
    }
  })

  it.skipIf(!canRefuseWrites).each([
    ['new takes', takes, { count: 1 }],
    ['Make all', makeAll, undefined],
  ])(
    'gives the route’s refusal for %s on a board that cannot be written',
    async (_, path, body) => {
      const s = start({ 'content-studio/cache/music/other.json': '{}' })
      try {
        await refusingWrites(join(s.root, 'content-studio/cache/music'), () => same(s, path, body))
      } finally {
        s.studio.stop(true)
      }
    },
  )

  it('names a track or list that is not there, and asks nothing', async () => {
    const s = start()
    try {
      for (const [path, body] of [
        ['/api/music/tracks/nope/takes', { count: 1 }],
        ['/api/music/lists/nope/make-all', undefined],
      ] as const) {
        expect(await s.post(path, body)).toStartWith('404 ')
        // The route that makes says only "not found"; its cost route is the one that names it.
        const named = await s.post(`${path}/cost`, body)
        expect(named).toStartWith('404 ')
        expect(named).toContain('nope')
        const asked = await s.act(path, body)
        expect(asked.isError).toBe(true)
        expect(asked.content[0]!.text).toBe(named)
      }
    } finally {
      s.studio.stop(true)
    }
  })

  it('answers a Make all that would make nothing, and asks nothing', async () => {
    const s = start({ 'tts/act1/music.json': [] })
    try {
      const answer = await s.act(makeAll, undefined)
      expect(answer.isError).toBeUndefined()
      expect(JSON.parse(answer.content[0]!.text)).toEqual({ ok: true, tracks: 0, takes: 0 })
      expect(s.generated()).toBe(0)
    } finally {
      s.studio.stop(true)
    }
  })
})
