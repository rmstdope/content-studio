import { afterAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { startServer } from './index'
import { encode, fish } from './test-support'

describe('the count of changes an agent made through the MCP', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/public/images/generated',
        manifest: 'web/public/images/generated/manifest.json',
      },
    }),
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 },
    ],
  })
  const studio = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    fish,
    encode,
    transcriber: null,
  })
  afterAll(() => studio.stop(true))

  const count = async () =>
    ((await (await fetch(new URL('/api/agent-changes', studio.url))).json()) as { count: number })
      .count
  const act = async (args: Record<string, unknown>) =>
    (
      (await (
        await fetch(new URL('/mcp', studio.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'studio_act', arguments: args },
          }),
        })
      ).json()) as { result: { isError?: true } }
    ).result

  it('starts at zero, counts a step that was done, and not one that was refused or failed', async () => {
    expect(await count()).toBe(0)
    expect((await act({ method: 'GET', path: '/api/project' })).isError).toBe(true)
    expect(
      (await act({ method: 'PATCH', path: '/api/images/nope', body: { words: 'x' } })).isError,
    ).toBe(true)
    expect(await count()).toBe(0)
    expect(
      (await act({ method: 'PATCH', path: '/api/images/inn', body: { words: 'a warm inn' } }))
        .isError,
    ).toBeUndefined()
    expect(await count()).toBe(1)
  })
})
