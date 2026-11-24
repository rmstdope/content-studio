import { afterAll, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { fakePng } from '../services/imagesFake'
import { startServer } from './index'
import { encode, fish } from './test-support'

/** What a tool call answers, as far as these tests look. */
interface Called {
  isError?: true
  content: { type: string; text: string }[]
}

describe('an agent doing the Images steps through the MCP', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      refresh: {
        part: "cp tts/more.json tts/{part}/images.json && echo '[]' > tts/{part}/script.json",
      },
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/public/images/generated',
        manifest: 'web/public/images/generated/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      {
        id: 'inn',
        title: 'Inn',
        text: 'a low inn',
        width: 320,
        height: 200,
        areas: [{ id: 'sign', title: 'Sign' }],
      },
    ],
    'tts/more.json': [
      { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200, areas: [] },
      { id: 'well', title: 'Well', text: 'a stone well', width: 320, height: 200 },
    ],
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
    images: {
      ready: () => ({ ok: true }),
      installed: () => true,
      generate: async (request) => ({
        png: fakePng(request.width, request.height, request.seed),
        seed: request.seed,
      }),
    },
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
    const r = ((await response.json()) as { result: Called }).result
    return r
  }
  const text = (c: Called) => c.content[0]!.text
  const read = async (path: string) => (await fetch(new URL(path, studio.url))).json()
  const summary = async () => (await read('/api/project')).summary.images
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const v = await read('/api/images/inn/takes')
      if (!v.making.length && !v.takes.some((t: { look: string }) => t.look === 'bringing'))
        return v
      await new Promise((r) => setTimeout(r, 5))
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

  it('lists the steps with the ones that need the user’s confirmation', async () => {
    const response = await fetch(new URL('/mcp', studio.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'studio_pages', arguments: {} },
      }),
    })
    const pages = JSON.parse(
      ((await response.json()) as { result: Called }).result.content[0]!.text,
    ) as { actions: Record<string, { path: string; confirm?: string }[]> }
    const images = pages.actions.Images ?? []
    expect(images.map((a) => a.path)).toContain('/api/images/:id/zoom')
    expect(images.filter((a) => a.confirm).length).toBeGreaterThan(3)
  })

  it('saves the style and the image’s words', async () => {
    expect(
      (await act({ method: 'PATCH', path: '/api/image-style', body: { look: 'oil paint' } }))
        .isError,
    ).toBeUndefined()
    expect(
      (await act({ method: 'PATCH', path: '/api/images/inn', body: { words: 'a warm inn' } }))
        .isError,
    ).toBeUndefined()
    expect((await summary()).acts[0].rows[0].words).toBe('a warm inn')
  })

  it('makes takes, and does not choose or drop one without the user’s confirmation', async () => {
    expect(
      (await act({ method: 'POST', path: '/api/images/inn/takes', body: { count: 2 } })).isError,
    ).toBeUndefined()
    await settled()
    const before = listing(root)
    for (const args of [
      { method: 'POST', path: '/api/images/inn/choose', body: { n: 1 } },
      { method: 'DELETE', path: '/api/images/inn/takes/2' },
      { method: 'POST', path: '/api/images/inn/unchoose' },
    ]) {
      const answer = await act(args)
      expect(answer.isError).toBe(true)
      expect(text(answer)).toContain('confirmation')
    }
    expect(listing(root)).toEqual(before)
  })

  it('does them once confirmed, and a refusal comes back as an error with the reason', async () => {
    expect(
      (
        await act({
          method: 'POST',
          path: '/api/images/inn/choose',
          body: { n: 1 },
          confirmed: true,
        })
      ).isError,
    ).toBeUndefined()
    expect((await read('/api/images/inn/takes')).takes[0].chosen).toBe(true)
    const refused = await act({
      method: 'DELETE',
      path: '/api/images/inn/takes/1',
      confirmed: true,
    })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('409')
    expect(
      (await act({ method: 'DELETE', path: '/api/images/inn/takes/2', confirmed: true })).isError,
    ).toBeUndefined()
    expect((await read('/api/images/inn/takes')).takes.length).toBe(1)
  })

  it('places an area and sets the zoom of a chosen image, then un-chooses it', async () => {
    const box = { x: 32, y: 20, width: 64, height: 40 }
    expect(
      (await act({ method: 'PUT', path: '/api/images/inn/areas/sign', body: { box } })).isError,
    ).toBeUndefined()
    const zoom = { on: true, seconds: 20, percent: 5 }
    expect(
      (await act({ method: 'PUT', path: '/api/images/inn/zoom', body: { zoom } })).isError,
    ).toBeUndefined()
    expect((await summary()).acts[0].rows[0].areas[0].box).toMatchObject(box)
    expect(
      (await act({ method: 'POST', path: '/api/images/inn/unchoose', confirmed: true })).isError,
    ).toBeUndefined()
  })

  it('refreshes an act’s images from the game through the part route', async () => {
    expect((await act({ method: 'POST', path: '/api/parts/act1/refresh' })).isError).toBeUndefined()
    const rows = (await summary()).acts[0].rows.map((r: { id: string }) => r.id)
    expect(rows).toContain('well')
    // The other steps reach their routes: a refusal names its reason, never "not something to do".
    for (const args of [
      { method: 'PUT', path: '/api/images/inn/effects', body: { effects: {} } },
      { method: 'POST', path: '/api/images/inn/copy', body: { from: 'well' } },
      { method: 'POST', path: '/api/images/inn/fine-tunes/use', body: { n: 1 } },
      {
        method: 'POST',
        path: '/api/images/inn/patches/lamp/choose',
        body: { n: 1 },
        confirmed: true,
      },
      { method: 'POST', path: '/api/image-acts/act1/make-all', confirmed: true },
    ]) {
      expect(text(await act(args))).not.toContain('Not something to do')
    }
  })
  it('reads an act’s images with what each still lacks and why it is out of date', async () => {
    const call = async (name: string, args: Record<string, unknown>) => {
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
      return ((await response.json()) as { result: Called }).result
    }
    const pages = JSON.parse(text(await call('studio_pages', {}))) as {
      read: Record<string, { path: string }[]>
    }
    expect((pages.read.Images ?? []).map((r) => r.path)).toContain('/api/image-acts/:id')
    expect(
      (await act({ method: 'POST', path: '/api/images/well/takes', body: { count: 1 } })).isError,
    ).toBeUndefined()
    for (let i = 0; i < 200; i++) {
      const v = await read('/api/images/well/takes')
      if (!v.making.length && v.takes.length) break
      await new Promise((r) => setTimeout(r, 5))
    }
    await act({
      method: 'POST',
      path: '/api/images/well/choose',
      body: { n: 1 },
      confirmed: true,
    })
    await act({ method: 'PATCH', path: '/api/images/well', body: { words: 'a mossy well' } })
    const report = JSON.parse(
      text(await call('studio_read', { path: '/api/image-acts/act1' })),
    ) as { images: { id: string; status: string; missing: unknown; reasons: string[] }[] }
    expect(report.images.find((i) => i.id === 'inn')).toMatchObject({
      status: 'none yet',
      missing: { patches: [], areas: [] },
    })
    expect(report.images.find((i) => i.id === 'well')).toMatchObject({
      status: 'out of date',
      reasons: ['the words'],
    })
    expect((await fetch(new URL('/api/image-acts/nope', studio.url))).status).toBe(404)
  })
})
