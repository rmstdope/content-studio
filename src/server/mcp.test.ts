import { afterAll, describe, expect, it } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { fakePng } from '../services/imagesFake'
import { createContext } from './context'
import { startServer, studioRoutes } from './index'
import { READABLE } from './mcpReadable'
import { startBase } from './test-support'

interface Reply {
  status: number
  body: any
}

/** Sends one JSON-RPC message (or a batch) to the studio's MCP endpoint. */
function client(base: URL, headers: Record<string, string> = {}) {
  const post = async (message: unknown, extra: Record<string, string> = {}): Promise<Reply> => {
    const response = await fetch(new URL('/mcp', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers, ...extra },
      body: JSON.stringify(message),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  let id = 0
  const call = async (name: string, args: unknown) =>
    (
      await post({
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name, arguments: args },
      })
    ).body.result
  return { post, call }
}

/** Every file under a folder with its size and time, to see that nothing was written. */
function snapshot(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).sort().map((f) => {
    const s = statSync(join(dir, f))
    return `${f} ${s.size} ${s.mtimeMs}`
  })
}

describe('the MCP endpoint', () => {
  const { root, server } = startBase()
  const mcp = client(server.url)

  it('answers initialize, ping and the initialized notification', async () => {
    const init = await mcp.post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    })
    expect(init.body.result.protocolVersion).toBe('2025-06-18')
    expect(init.body.result.capabilities).toEqual({ tools: {} })
    expect(init.body.result.serverInfo.name).toBe('content-studio')
    const old = await mcp.post({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    })
    expect(old.body.result.protocolVersion).toBe('2025-06-18')
    expect((await mcp.post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(
      202,
    )
    expect((await mcp.post({ jsonrpc: '2.0', id: 3, method: 'ping' })).body.result).toEqual({})
  })

  it('refuses what it does not understand', async () => {
    expect((await mcp.post({ jsonrpc: '2.0', id: 1, method: 'nope' })).body.error.code).toBe(-32601)
    const bad = await fetch(new URL('/mcp', server.url), { method: 'POST', body: '{' })
    expect([bad.status, (await bad.json()).error.code]).toEqual([400, -32700])
    expect((await mcp.post(42)).body.error.code).toBe(-32600)
    for (const method of ['GET', 'DELETE']) {
      expect((await fetch(new URL('/mcp', server.url), { method })).status).toBe(405)
    }
  })

  it('answers a batch', async () => {
    const batch = await mcp.post([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    expect(batch.body.map((r: { id: number }) => r.id)).toEqual([1, 2])
  })

  it('takes requests addressed to the studio from no browser page only', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
    expect((await mcp.post(ping, { origin: 'http://evil.test' })).status).toBe(403)
    expect((await mcp.post(ping, { origin: server.url.origin })).status).toBe(200)
    expect((await mcp.post(ping, { host: 'evil.test' })).status).toBe(403)
  })

  it('lists three tools', async () => {
    const list = await mcp.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'studio_pages',
      'studio_read',
      'studio_fetch',
    ])
  })

  it('tells the pages and what each shows', async () => {
    const result = await mcp.call('studio_pages', {})
    const pages = JSON.parse(result.content[0].text)
    expect(Object.keys(pages).sort()).toEqual([
      'Images',
      'Music and Stingers',
      'Narration',
      'Scenes',
      'Setup',
      'Sound effects',
    ])
    expect(pages.Setup[0]).toMatchObject({ path: '/api/project', kind: 'state' })
  })

  it('reads what the page shows, the same as the page gets it', async () => {
    for (const path of ['/api/project', '/api/parts/act1', '/api/narration/progress']) {
      const result = await mcp.call('studio_read', { path })
      const direct = await (await fetch(new URL(path, server.url))).json()
      expect(result.isError).toBeUndefined()
      expect(JSON.parse(result.content[0].text)).toEqual(direct)
    }
  })

  it('says why a read failed, and refuses a path that is not listed', async () => {
    const missing = await mcp.call('studio_read', { path: '/api/parts/nope' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain('404')
    for (const path of ['/api/nothing', '/api/parts/act1/clips/a.mp3', '/api/parts/../project']) {
      const refused = await mcp.call('studio_read', { path })
      expect(refused.isError).toBe(true)
    }
    expect((await mcp.call('studio_read', {})).isError).toBe(true)
    expect((await mcp.call('studio_nothing', {})).isError).toBe(true)
  })

  it('fetches a recorded line as sound, with its bytes', async () => {
    const result = await mcp.call('studio_fetch', { path: '/api/parts/act1/clips/a.mp3' })
    expect(result.isError).toBeUndefined()
    const audio = result.content.find((c: { type: string }) => c.type === 'audio')
    expect(audio.mimeType).toStartWith('audio/')
    expect(Buffer.from(audio.data, 'base64').toString()).toBe('ID3-not-really-audio')
    expect((await mcp.call('studio_fetch', { path: '/api/project' })).isError).toBe(true)
    expect((await mcp.call('studio_fetch', { path: '/api/parts/act1/clips/zz.mp3' })).isError).toBe(
      true,
    )
  })

  it('writes nothing', async () => {
    const before = snapshot(root)
    for (const entry of READABLE.filter((r) => r.kind === 'state' && !r.path.includes(':'))) {
      await mcp.call('studio_read', { path: entry.path })
    }
    await mcp.call('studio_fetch', { path: '/api/parts/act1/clips/a.mp3' })
    expect(snapshot(root)).toEqual(before)
  })
})

describe('the MCP endpoint and images', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 },
    ],
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
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
  const mcp = client(studio.url)

  it('fetches an image take and the chosen image as pictures', async () => {
    const origin = { origin: studio.url.origin, 'content-type': 'application/json' }
    await fetch(new URL('/api/images/inn/takes', studio.url), {
      method: 'POST',
      headers: origin,
      body: JSON.stringify({ count: 1 }),
    })
    for (let i = 0; i < 200; i++) {
      const view = await (await fetch(new URL('/api/images/inn/takes', studio.url))).json()
      if (view.takes.length && view.takes.every((t: { look: string }) => t.look === 'ready')) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await fetch(new URL('/api/images/inn/choose', studio.url), {
      method: 'POST',
      headers: origin,
      body: JSON.stringify({ n: 1 }),
    })
    for (const path of ['/api/images/inn/takes/1', '/api/images/inn/current']) {
      const result = await mcp.call('studio_fetch', { path })
      const image = result.content.find((c: { type: string }) => c.type === 'image')
      expect(image.mimeType).toBe('image/png')
      const direct = new Uint8Array(await (await fetch(new URL(path, studio.url))).arrayBuffer())
      expect(new Uint8Array(Buffer.from(image.data, 'base64'))).toEqual(direct)
    }
  })
})

describe('what an agent may read, against the server', () => {
  const root = tempRepo({ 'content-studio.json': projectJson() })
  const routes = studioRoutes(
    createContext({ projectFile: join(root, 'content-studio.json'), port: 0 }),
  )
  const gets = Object.entries(routes as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'object' && v !== null && 'GET' in v)
    .map(([path]) => path)
    .sort()

  it('lists every GET route of the API, and only those', () => {
    expect(READABLE.map((r) => r.path).sort()).toEqual(gets.filter((p) => p.startsWith('/api/')))
  })
})
