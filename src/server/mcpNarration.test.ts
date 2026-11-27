import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createContext } from './context'
import { startServer } from './index'
import { matchAction } from './mcpActions'
import { SETUP_AND_NARRATION_ACTIONS } from './mcpActionsNarration'
import { musicRoutes } from './routes/music'
import { narrationRoutes } from './routes/narration'
import { setupRoutes } from './routes/setup'
import { encode, fish, startBase } from './test-support'

/** What a tool answer holds, as far as the tests look. */
interface Result {
  isError?: true
  content: { type: string; text: string }[]
}

/** Calls the studio's MCP tools. */
function client(base: URL, headers: Record<string, string> = {}) {
  const post = async (message: unknown, extra: Record<string, string> = {}) =>
    fetch(new URL('/mcp', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers, ...extra },
      body: JSON.stringify(message),
    })
  let id = 0
  const call = async (name: string, args: unknown): Promise<Result> => {
    const response = await post({
      jsonrpc: '2.0',
      id: ++id,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    return (await response.json()).result
  }
  return { post, call }
}

/** Every file under a folder with its size and time, to see that nothing was written. */
function snapshot(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).sort().map((f) => {
    const s = statSync(join(dir, f))
    return `${f} ${s.size} ${s.mtimeMs}`
  })
}

describe('what an agent may do, against the server', () => {
  const root = tempRepo({ 'content-studio.json': projectJson() })
  const context = createContext({ projectFile: join(root, 'content-studio.json'), port: 0 })
  // The Music model is saved from Setup's Models panel, though its route is the music routes'.
  const music = musicRoutes(context) as Record<string, Record<string, unknown>>
  const routes = {
    ...setupRoutes(context),
    ...narrationRoutes(context),
    '/api/music/model': music['/api/music/model']!,
  } as Record<string, Record<string, unknown>>
  const changes = Object.entries(routes)
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => method !== 'GET')
        .map((method) => `${method} ${path}`),
    )
    .sort()

  it('lists every change of Setup and Narration, and only those', () => {
    const listed = SETUP_AND_NARRATION_ACTIONS.map((a) => `${a.method} ${a.path}`).sort()
    // The part's Refresh dialog route is one entry, listed with the Images and Music steps, for both pages.
    const shared = ['POST /api/parts/:part/refresh', 'PUT /api/music/model']
    expect(listed).toEqual(changes.filter((c) => !shared.includes(c)))
    expect(changes).toEqual(expect.arrayContaining(shared))
    expect(matchAction('POST', '/api/parts/act1/refresh')).not.toBeNull()
    expect(matchAction('PUT', '/api/music/model')).not.toBeNull()
  })
})

describe('an agent acting on Setup and Narration', () => {
  const { root, server } = startBase()
  const mcp = client(server.url)
  const text = (result: Result) => result.content[0]!.text

  it('lists what it can do, by page, with what needs confirming', async () => {
    const acts = JSON.parse(text(await mcp.call('studio_pages', {}))).actions
    expect(acts.Setup.some((a: { path: string }) => a.path === '/api/take-fade')).toBe(true)
    expect(acts.Narration.find((a: { path: string }) => a.path.endsWith('/level')).confirm).toBe(
      "replaces the voice's clips in the game with ones at the new level",
    )
  })

  it('makes a change the way the page does', async () => {
    const result = await mcp.call('studio_act', {
      method: 'PATCH',
      path: '/api/take-fade',
      body: { seconds: 0.25 },
    })
    expect(result.isError).toBeUndefined()
    expect(readFileSync(join(root, 'content-studio/cache/settings.json'), 'utf8')).toContain('0.25')
  })

  it('says why the studio refused a change', async () => {
    const result = await mcp.call('studio_act', {
      method: 'PATCH',
      path: '/api/take-fade',
      body: { seconds: -1 },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('400')
  })

  it('refuses what is not registered, and any other method', async () => {
    for (const args of [
      { method: 'PATCH', path: '/api/nothing' },
      { method: 'GET', path: '/api/project' },
      { method: 'POST', path: '/api/music/tracks/a/takes' },
      { method: 'PATCH', path: '/api/parts/../take-fade' },
      { method: 'PATCH' },
      {},
    ]) {
      expect((await mcp.call('studio_act', args)).isError).toBe(true)
    }
  })

  it('asks for the confirmation the page asks for, and changes nothing without it', async () => {
    const before = snapshot(root)
    const args = { method: 'POST', path: '/api/characters/narrator/level', body: { level: 80 } }
    const refused = await mcp.call('studio_act', args)
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('confirmed: true')
    expect(text(refused)).toContain("replaces the voice's clips")
    expect(snapshot(root)).toEqual(before)
    const sent = await mcp.call('studio_act', { ...args, confirmed: true })
    expect(sent.isError).toBeUndefined()
    expect(JSON.parse(text(sent))).toMatchObject({ ok: true })
  })

  it('saves the words and the settings the pages save', async () => {
    for (const [method, path, body] of [
      ['PATCH', '/api/fish-tier', { tier: null }],
      ['PATCH', '/api/sound-alike', { groups: [['to', 'too']], was: [] }],
      ['PATCH', '/api/pronounce', { table: [['Mara', 'Mahra']], was: [] }],
    ] as const) {
      const result = await mcp.call('studio_act', { method, path, body })
      expect(result.isError).toBeUndefined()
    }
    expect(readFileSync(join(root, 'content-studio.json'), 'utf8')).toContain('too')
  })

  it('asks before deleting a take and before putting lines back, and says what the route refused', async () => {
    const before = snapshot(root)
    for (const [method, path] of [
      ['DELETE', '/api/parts/act1/lines/a/takes/x.wav'],
      ['POST', '/api/characters/narrator/cleaned-lines/put-back'],
    ] as const) {
      const refused = await mcp.call('studio_act', { method, path })
      expect(refused.isError).toBe(true)
      expect(text(refused)).toContain('confirmed: true')
    }
    expect(snapshot(root)).toEqual(before)
    // What the route refuses (no audition to cast from) comes back as an error with its reason.
    const cast = await mcp.call('studio_act', {
      method: 'POST',
      path: '/api/auditions/narrator/cast',
      body: { voice: 'w1' },
      confirmed: true,
    })
    expect(cast.isError).toBe(true)
    expect(text(cast)).toMatch(/^409 .*no-session/)
  })

  it('sends recordings to the studio as a form', async () => {
    const result = await mcp.call('studio_act', {
      method: 'POST',
      path: '/api/characters/narrator/clone-voice',
      body: { title: 'Mine' },
      files: [{ field: 'voices', name: 'a.wav', type: 'audio/wav', base64: 'AAAA' }],
    })
    // The route parsed the form (a title and a recording) and went on to Fish, which the fake refuses.
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('expected a form')
    expect(text(result)).toContain('not used')
  })

  it('refuses a recording that is no recording, and a form value that is no text', async () => {
    const path = '/api/characters/narrator/clone-voice'
    for (const args of [
      { body: { title: 'Mine' }, files: [{ field: 'voices' }] },
      { body: { title: 'Mine' }, files: ['x'] },
      { body: { title: { a: 1 } }, files: [{ field: 'voices', name: 'a.wav', base64: 'AAAA' }] },
    ]) {
      const result = await mcp.call('studio_act', { method: 'POST', path, ...args })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/files|must be text/)
    }
  })

  it('does not reach the studio from a page of another site', async () => {
    const answer = await client(server.url).post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'studio_act',
          arguments: { method: 'PATCH', path: '/api/take-fade', body: { seconds: 1 } },
        },
      },
      { origin: 'http://evil.test' },
    )
    expect(answer.status).toBe(403)
  })
})

describe('an agent casting a voice and recording a line', () => {
  const { root, server } = startBase()
  const mcp = client(server.url)
  const act = (method: string, path: string, body?: unknown) =>
    mcp.call('studio_act', { method, path, body })

  it('does it through the studio alone, as the page does', async () => {
    expect(
      (await act('PATCH', '/api/characters/narrator', { keywords: ['warm'] })).isError,
    ).toBeUndefined()
    expect((await act('POST', '/api/auditions/narrator/start')).isError).toBeUndefined()
    expect((await act('POST', '/api/auditions/narrator/more')).isError).toBeUndefined()
    expect(
      (await act('POST', '/api/auditions/narrator/move', { voice: 'w1', move: 'shortlist' }))
        .isError,
    ).toBeUndefined()
    const cast = await mcp.call('studio_act', {
      method: 'POST',
      path: '/api/auditions/narrator/cast',
      body: { voice: 'w1' },
      confirmed: true,
    })
    expect(cast.isError).toBeUndefined()
    const file = JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8'))
    expect(file.speakers.narrator.voice).toBe('w1')
    const recorded = await act('POST', '/api/parts/act1/lines/a/record', { stage: 'final' })
    expect(recorded.content[0]!.text).toContain('"ok":true')
  })
})

// The tests share one project and run in order: the last one removes the orphans.
describe('an agent recording a batch that removes orphaned clips', () => {
  const root = tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
    'audio/act1/manifest.json': { old: { file: 'old.mp3' }, gone: { file: 'gone.mp3' } },
    'audio/act1/old.mp3': 'x',
    'audio/act1/gone.mp3': 'x',
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))
  const mcp = client(studio.url)
  const path = '/api/parts/act1/jobs'
  const record = (orphans: string[], keys: string[], confirmed?: boolean) =>
    mcp.call('studio_act', {
      method: 'POST',
      path,
      body: { speaker: null, keys, orphans },
      confirmed,
    })
  /** Waits for the job the answer started to end. */
  const finished = async (started: Result) => {
    const { id } = JSON.parse(started.content[0]!.text)
    let state = { status: 'running' }
    while (state.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      state = await (await fetch(new URL(`/api/jobs/${id}`, studio.url))).json()
    }
    return state
  }
  const clips = ['old', 'gone'].map((key) => join(root, `audio/act1/${key}.mp3`))

  it('says in studio_pages when the batch asks', async () => {
    const pages = JSON.parse((await mcp.call('studio_pages', {})).content[0]!.text)
    expect(
      pages.actions.Narration.find((a: { path: string }) => a.path.endsWith('/jobs')).confirm,
    ).toBe(
      'only for a record job whose orphans is not empty: deletes those orphaned clips from the game',
    )
  })

  it('asks first, recording and removing nothing', async () => {
    const before = snapshot(root)
    const refused = await record(['old', 'gone'], ['a'])
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toBe(
      "Needs the user's confirmation first: this deletes 2 orphaned clips from the game (their lines left the dialog). Once the user has agreed, call again with confirmed: true.",
    )
    expect(snapshot(root)).toEqual(before)
  })

  it('records a batch that removes none without asking', async () => {
    const started = await record([], ['a'])
    expect(started.isError).toBeUndefined()
    expect(await finished(started)).toMatchObject({ status: 'done', done: 1, removed: 0 })
    expect(clips.every((clip) => existsSync(clip))).toBe(true)
  })

  it('removes the orphans once confirmed', async () => {
    const started = await record(['old', 'gone'], [], true)
    expect(started.isError).toBeUndefined()
    expect(await finished(started)).toMatchObject({ status: 'done', removed: 2 })
    expect(clips.some((clip) => existsSync(clip))).toBe(false)
  })
})
