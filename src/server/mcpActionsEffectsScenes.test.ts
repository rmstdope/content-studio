import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createContext } from './context'
import { studioRoutes } from './index'
import { matchAction } from './mcpActions'
import { EFFECTS_AND_SCENES_ACTIONS } from './mcpActionsEffectsScenes'

describe('the Sound effects and Scenes steps an agent may do', () => {
  it('matches each step by method and route', () => {
    expect(matchAction('POST', '/api/effects/refresh')?.page).toBe('Sound effects')
    expect(matchAction('PATCH', '/api/effects/door')?.page).toBe('Sound effects')
    expect(matchAction('POST', '/api/effects/door/keep-mine')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/door/takes')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/door/choose')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/door/trim')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/door/accept')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/door/stop')).not.toBeNull()
    expect(matchAction('PUT', '/api/effects/door/takes/a.wav/fades')).not.toBeNull()
    expect(matchAction('DELETE', '/api/effects/door/takes/a.wav/fades')).not.toBeNull()
    expect(matchAction('PUT', '/api/effects/door/takes/a.wav/level')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/make-all')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/batch/close')).not.toBeNull()
    expect(matchAction('POST', '/api/effects/stop-all')).not.toBeNull()
    expect(matchAction('POST', '/api/scene-loudness/act1')?.page).toBe('Scenes')
    expect(matchAction('PUT', '/api/scenes/act1/door')?.page).toBe('Scenes')
  })

  it('refuses another method, and a path that climbs out', () => {
    expect(matchAction('GET', '/api/effects/refresh')).toBeNull()
    expect(matchAction('DELETE', '/api/effects/refresh')).toBeNull()
    expect(matchAction('PUT', '/api/effects/door/choose')).toBeNull()
    expect(matchAction('PUT', '/api/scenes/../door')).toBeNull()
  })

  it('asks for the confirmation the web page asks for', () => {
    for (const [method, path] of [
      ['POST', '/api/effects/door/forget'],
      ['POST', '/api/effects/door/unchoose'],
      ['DELETE', '/api/effects/door/takes/a.wav'],
      ['POST', '/api/effects/make-all'],
    ] as const) {
      expect(matchAction(method, path)?.confirm).toBeTruthy()
    }
    for (const [method, path] of [
      ['PATCH', '/api/effects/door'],
      ['POST', '/api/effects/door/choose'],
      ['PUT', '/api/scenes/act1/door'],
    ] as const) {
      expect(matchAction(method, path)?.confirm).toBeUndefined()
    }
  })
})

describe('the Sound effects and Scenes steps, against the server', () => {
  const root = tempRepo({ 'content-studio.json': projectJson() })
  const routes = studioRoutes(
    createContext({ projectFile: join(root, 'content-studio.json'), port: 0 }),
  ) as unknown as Record<string, Record<string, unknown>>
  const changes = Object.entries(routes)
    .filter(([path]) => /^\/api\/(effects|scene-loudness|scenes)(\/|$)/.test(path))
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => method !== 'GET')
        .map((method) => `${method} ${path}`),
    )
    .sort()

  it('lists every change route of those pages, and only those', () => {
    expect(EFFECTS_AND_SCENES_ACTIONS.map((a) => `${a.method} ${a.path}`).sort()).toEqual(changes)
  })
})
