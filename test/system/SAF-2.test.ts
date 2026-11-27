/**
 * SAF-2: Only the studio's own page can change anything: a change asked for by another web page or
 * address is refused.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createContext } from '../../src/server/context'
import { studioRoutes } from '../../src/server/index'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const { root, options, url, page, agent } = startStudio({
  'content-studio.json': projectJson(),
  'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
})

/** Every file of the game with its content, to see that nothing was changed, added or removed. */
function game(): Record<string, string> {
  const paths = (readdirSync(root, { recursive: true }) as string[]).sort()
  return Object.fromEntries(
    paths
      .filter((path) => statSync(join(root, path)).isFile())
      .map((path) => [path, readFileSync(join(root, path), 'utf8')]),
  )
}

/** The narrator's style as saved in the game. */
function savedStyle(): unknown {
  return JSON.parse(game()['content-studio/narration/cast.json']!).speakers.narrator.style
}

/** A request for a change, sent with `headers` saying where it comes from. */
function ask(method: string, path: string, headers: Record<string, string>, body: unknown = {}) {
  return fetch(new URL(path, url), {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** An agent's step sent to the MCP endpoint with `headers`, as something posing as the agent would. */
function posingAsAgent(step: unknown, headers: Record<string, string>) {
  const params = { name: 'studio_act', arguments: step }
  return ask('POST', '/mcp', headers, { jsonrpc: '2.0', id: 1, method: 'tools/call', params })
}

/** The agent's step that saves the narrator's style. */
const restyle = (style: string) => ({
  method: 'PATCH',
  path: '/api/characters/narrator',
  body: { style },
})

const elsewhere = 'https://evil.example'
const port = Number(url.port)

/** Who must not change anything: other web pages, and the studio reached under another name. */
const strangers: Record<string, Record<string, string>> = {
  'another web site': { origin: elsewhere },
  'another page on this computer': { origin: `http://127.0.0.1:${port === 1 ? 2 : port - 1}` },
  'a page with no origin of its own': { origin: 'null' },
  'a request that names no page': {},
  // DNS rebinding: a site points its own name at this computer, so the browser sees one origin.
  // Its Origin alone refuses this change; the Host check is held to by the call to /mcp below
  // that names no page.
  'a site whose name points here': {
    host: `evil.example:${port}`,
    origin: `http://evil.example:${port}`,
  },
}

describe('SAF-2: only the studio’s own page can change anything', () => {
  it('refuses a change asked for by another web page or address, and changes nothing', async () => {
    const before = game()
    const { method, path, body } = restyle('[intruder]')

    for (const [who, headers] of Object.entries(strangers)) {
      expect([who, (await ask(method, path, headers, body)).status]).toEqual([who, 403])
    }
    // The agent's way in is open to no web page either.
    for (const who of ['another web site', 'a page with no origin of its own']) {
      const response = await posingAsAgent(restyle('[intruder]'), strangers[who]!)
      expect([who, response.status]).toEqual([who, 403])
    }
    const rebound = await posingAsAgent(restyle('[intruder]'), { host: `evil.example:${port}` })
    expect(rebound.status).toBe(403)

    expect(game()).toEqual(before)
  })

  it('refuses another web page every change the studio has', async () => {
    const routes = Object.entries(studioRoutes(createContext(options)) as Record<string, unknown>)
    // A route that is one function answers every method, so the walk could not see its changes:
    // only the answer for an unknown address may be one.
    const bare = routes.filter(([, handlers]) => typeof handlers === 'function')
    expect(bare.map(([route]) => route)).toEqual(['/api/*'])
    const changes = routes
      // The agent's way in is no change of its own; it is walked above.
      .filter(([route]) => route !== '/mcp')
      .flatMap(([route, handlers]) =>
        Object.keys(typeof handlers === 'object' ? (handlers ?? {}) : {})
          .filter((method) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
          .map((method) => ({ method, route })),
      )
    // Every step the studio offers an agent is among them, so the walk below leaves none out.
    const listed = await agent.pages()
    const pages: Record<string, { method: string; path: string }[]> = JSON.parse(
      listed.content[0]!.text!,
    ).actions
    const offered = Object.values(pages).flat()
    expect(offered.length).toBeGreaterThan(0)
    const walked = changes.map(({ method, route }) => `${method} ${route}`)
    for (const { method, path } of offered) expect(walked).toContain(`${method} ${path}`)

    const before = game()
    const accepted: string[] = []
    for (const { method, route } of changes) {
      const path = route.replace(/:[^/]+/g, 'narrator')
      const { status } = await ask(method, path, { origin: elsewhere })
      if (status !== 403) accepted.push(`${method} ${route} answered ${status}`)
    }

    expect(accepted).toEqual([])
    expect(game()).toEqual(before)
  })

  it('takes the same change from its own page, and from the person’s agent', async () => {
    const { method, path, body } = restyle('[grave]')
    expect((await page.send(method, path, body)).status).toBe(200)
    expect(savedStyle()).toBe('[grave]')

    const step = restyle('[hushed]')
    const answer = await agent.act(step.method, step.path, step.body)
    expect(answer.isError).toBeUndefined()
    expect(savedStyle()).toBe('[hushed]')
  })
})
