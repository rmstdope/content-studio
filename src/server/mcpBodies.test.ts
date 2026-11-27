import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { bodyAllowed, bodyShape, bodyText } from '../core/bodyText'
import { startServer } from './index'
import { ACTIONS, actionBody, type Action } from './mcpActions'

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

  it('describes an action’s body from its schema', () => {
    const [first] = withSchema as [Action & { schema: Parameters<typeof bodyText>[0] }]
    expect(actionBody(first)).toBe(bodyText(first.schema))
  })
})
