import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { bodyAllowed, bodyShape } from '../core/bodyText'
import { startServer } from './index'
import { ACTIONS } from './mcpActions'

/** A value for each part of a route that varies, one the route takes as far as its body. */
const PARTS: Record<string, string> = { part: 'act1', stage: 'draft', file: 'a.mp3', n: '1' }

/** An action's route with its varying parts filled in. */
const at = (path: string) => path.replace(/:(\w+)/g, (_, name: string) => PARTS[name] ?? 'a')

const withSchema = ACTIONS.flatMap((action) =>
  action.body && !('form' in action.body) ? [{ ...action, schema: action.body }] : [],
)

describe('the body an agent is told, against the body the route takes', () => {
  const root = tempRepo({ 'content-studio.json': projectJson() })
  const studio = startServer({ projectFile: join(root, 'content-studio.json'), port: 0 })

  // A number fits no body, so each route answers what its own schema takes. An entry that names a
  // field the route's schema does not have says something else, and fails here.
  it.each(withSchema.map((a) => [`${a.method} ${a.path}`, a] as const))(
    '%s',
    async (_, { method, path, schema }) => {
      const response = await fetch(new URL(at(path), studio.url), {
        method,
        headers: { origin: studio.url.origin, 'content-type': 'application/json' },
        body: '42',
      })
      expect(response.status).toBe(400)
      const { error } = (await response.json()) as { error: string }
      expect(error).toStartWith(`expected ${bodyShape(schema)}: `)
      expect(error).toEndWith(`. ${bodyAllowed(schema)}`)
    },
  )

  it('writes a body by hand only for the one route that takes a form', () => {
    const byHand = ACTIONS.filter((a) => a.body && 'form' in a.body).map((a) => a.path)
    expect(byHand).toEqual(['/api/characters/:id/clone-voice'])
  })

  it('shows each body to an agent in words, through studio_pages', async () => {
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
    const { result } = (await response.json()) as { result: { content: { text: string }[] } }
    const { actions } = JSON.parse(result.content[0]!.text) as {
      actions: Record<string, { path: string; body?: unknown }[]>
    }
    const shown = (path: string) =>
      Object.values(actions)
        .flat()
        .find((a) => a.path === path)?.body
    expect(shown('/api/take-fade')).toBe('{ seconds }. Allowed: seconds is a number 0 or more.')
    expect(shown('/api/characters/:id/clone-voice')).toStartWith('form: title, ')
  })
})
