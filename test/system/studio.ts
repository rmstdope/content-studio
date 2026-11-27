import { afterAll } from 'bun:test'
import { join } from 'node:path'
import type { ElevenAccount } from '../../src/core/setup'
import { writeWav } from '../../src/core/wav'
import { startServer, type ServerOptions } from '../../src/server/index'
import { encode, fish } from '../../src/server/test-support'
import { createFakeEffects } from '../../src/services/effectsFake'
import { createFakeImages } from '../../src/services/imagesFake'
import { createFakeMusic } from '../../src/services/musicFake'
import { fakeEleven, tempRepo } from '../helpers'

/** What an MCP tool call answers. */
export interface ToolAnswer {
  isError?: true
  content: { type: string; text?: string; data?: string; mimeType?: string }[]
}

/** A silent mono WAV of `seconds` at `rate`, which tells one take from another by its length. */
export const wavOf = (seconds: number, rate = 1000) =>
  writeWav({
    format: { channels: 1, sampleRate: rate, bitsPerSample: 16 },
    data: new Uint8Array(seconds * rate * 2),
  })

/** Asks for the narration job `id` as the page does, until it is over; answers how it ended. */
export async function jobEnded(page: ReturnType<typeof pageOf>, id: string) {
  for (const giveUp = Date.now() + 10_000; ;) {
    const job = (await (await page.get(`/api/jobs/${id}`)).json()) as {
      status: string
      failed: unknown[]
    }
    if (job.status !== 'running') return job
    if (Date.now() > giveUp) throw new Error('the recording never ended')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** The requests the studio's own page makes, to the studio at `url`. */
function pageOf(url: URL) {
  return {
    get: (path: string) => fetch(new URL(path, url)),
    send: (method: string, path: string, body?: unknown) =>
      fetch(new URL(path, url), {
        method,
        headers: {
          origin: url.origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  }
}

/** An agent's MCP client, speaking to the studio at `url` over HTTP, with no Origin. */
function agentOf(url: URL) {
  let id = 0
  const post = (message: Record<string, unknown>) =>
    fetch(new URL('/mcp', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
    })
  async function request<T>(method: string, params: unknown): Promise<T> {
    const response = await post({ id: ++id, method, params })
    const answer = (await response.json()) as { result?: T; error?: { message: string } }
    if (answer.result === undefined) throw new Error(`${method}: ${answer.error?.message}`)
    return answer.result
  }
  const call = (name: string, args: unknown = {}) =>
    request<ToolAnswer>('tools/call', { name, arguments: args })
  return {
    /** The handshake a client opens with; answers the names of the tools offered. */
    async connect(): Promise<string[]> {
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
      await post({ method: 'notifications/initialized' })
      const { tools } = await request<{ tools: { name: string }[] }>('tools/list', {})
      return tools.map((tool) => tool.name)
    },
    pages: () => call('studio_pages'),
    read: (path: string) => call('studio_read', { path }),
    fetch: (path: string) => call('studio_fetch', { path }),
    act: (method: string, path: string, body?: unknown, confirmed?: boolean) =>
      call('studio_act', { method, path, body, confirmed }),
  }
}

/**
 * The start-up of a system test: the studio's real server on a temporary game holding `files`,
 * with every provider and model faked, so nothing reaches the network or uv. ffmpeg is the real
 * one where the studio uses it to measure a sound an agent fetches; without it that answer says
 * so and the sound is still handed over. `fakes` replaces any of the fakes. `folder` is where the
 * game's project file is in the temporary repository, for a game that has neighbours there. The
 * server stops when the test file is done. `url` and `options` are where it listens and what it
 * was started with.
 */
export function startStudio(
  files: Record<string, unknown>,
  fakes: Partial<ServerOptions> = {},
  folder = '.',
) {
  const root = tempRepo(files)
  const options: ServerOptions = {
    projectFile: join(root, folder, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    elevenlabs: fakeEleven({}, { account: ACCOUNT }).client,
    transcriber: null,
    music: createFakeMusic(0),
    effects: createFakeEffects(0),
    images: createFakeImages(0),
    sceneRender: async () => silence,
    ...fakes,
  }
  const server = startServer(options)
  afterAll(() => server.stop(true))
  const url = server.url
  return { root, options, url, page: pageOf(url), agent: agentOf(url) }
}

/** The fake ElevenLabs account. */
const ACCOUNT: ElevenAccount = {
  tier: 'creator',
  charactersUsed: 0,
  characterLimit: 100_000,
  renewsAt: null,
  overage: 0,
  voiceSlots: { used: 0, limit: 30 },
}

/** A second of silence, for every scene mix. */
const silence = wavOf(1)
