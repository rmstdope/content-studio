import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createContext } from './context'
import { studioRoutes } from './index'
import { matchAction } from './mcpActions'
import { SceneBody } from './shared'
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

describe('what the bodies of the fades and the scene mix say', () => {
  const body = (method: string, path: string) => matchAction(method, path)?.body ?? ''
  it('names the fade shapes and the lengths', () => {
    const text = body('PUT', '/api/effects/door/takes/a.wav/fades')
    for (const word of ['smooth', 'straight', 'seconds']) expect(text).toContain(word)
  })
  it('is about a body the route takes', () => {
    const effects = [
      { id: 'a', play: { mode: 'loop' }, level: 1 },
      { id: 'b', play: { mode: 'random', everySeconds: [1, 2] }, state: 's', level: 2 },
      { id: 'c', play: { mode: 'once', afterSeconds: 3 }, level: 0 },
      { id: 'd', play: { mode: 'trigger', trigger: 't' }, level: 3 },
    ]
    const body = {
      scene: { music: { track: null, level: 1 }, effects },
      was: null,
      moved: { db: 1, measuredAt: '2026-01-01T00:00:00Z' },
    }
    expect(SceneBody.safeParse(body).success).toBe(true)
  })
  it('describes the scene mix down to an effect entry', () => {
    const text = body('PUT', '/api/scenes/act1/door')
    for (const word of [
      'music',
      'track',
      'effects',
      'play',
      'loop',
      'random',
      'everySeconds',
      'once',
      'afterSeconds',
      'trigger',
      'state',
      'level',
      'was',
      'moved',
    ])
      expect(text).toContain(word)
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
