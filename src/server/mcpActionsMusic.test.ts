import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createContext } from './context'
import { studioRoutes } from './index'
import { matchAction } from './mcpActions'
import { MUSIC_ACTIONS } from './mcpActionsMusic'

describe('the Music and Stingers steps an agent may do', () => {
  it('matches each step by method and route, under its page', () => {
    expect(matchAction('PATCH', '/api/music/tracks/hall')?.page).toBe('Music and Stingers')
    expect(matchAction('POST', '/api/music/stingers/refresh')?.page).toBe('Music and Stingers')
    // An act's Refresh from the game is the part route, which the Images entries list once.
    expect(matchAction('POST', '/api/parts/act1/refresh')).not.toBeNull()
    expect(matchAction('PUT', '/api/music/model')?.page).toBe('Setup')
  })

  it('refuses another method, and a path that climbs out', () => {
    expect(matchAction('GET', '/api/music/tracks/hall/choose')).toBeNull()
    expect(matchAction('DELETE', '/api/music/tracks/hall/choose')).toBeNull()
    expect(matchAction('POST', '/api/music/tracks/../x/choose')).toBeNull()
    expect(matchAction('POST', '/api/music/tracks/a%2fb/choose')).toBeNull()
  })

  it('asks where the web page asks first, or shows a price', () => {
    for (const path of ['/api/music/tracks/hall/unchoose', '/api/music/tracks/hall/remove']) {
      expect(matchAction('POST', path)?.confirm).toBeTruthy()
    }
    for (const path of ['/api/music/tracks/hall/choose', '/api/music/tracks/hall/move']) {
      expect(matchAction('POST', path)?.confirm).toBeUndefined()
    }
    expect(matchAction('POST', '/api/music/tracks/hall/takes')?.spends).toBe('takes')
    expect(matchAction('POST', '/api/music/lists/act1/make-all')?.spends).toBe('make-all')
    expect(matchAction('PUT', '/api/music/model')?.spends).toBeUndefined()
  })
})

describe('what the body of a music take’s fades says', () => {
  it('names the lengths and the shapes', () => {
    const text = matchAction('PUT', '/api/music/tracks/hall/takes/a.mp3/fades')?.body ?? ''
    for (const word of ['seconds', 'smooth', 'straight']) expect(text).toContain(word)
  })
})

describe('the Music and Stingers steps, against the server', () => {
  const root = tempRepo({ 'content-studio.json': projectJson() })
  const routes = studioRoutes(
    createContext({ projectFile: join(root, 'content-studio.json'), port: 0 }),
  ) as unknown as Record<string, Record<string, unknown>>
  const changes = Object.entries(routes)
    .filter(([path]) => path.startsWith('/api/music/'))
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => method !== 'GET')
        .map((method) => `${method} ${path}`),
    )
    .sort()

  it('lists every change route of those pages, and only those', () => {
    expect(MUSIC_ACTIONS.map((a) => `${a.method} ${a.path}`).sort()).toEqual(changes)
  })
})

describe('what an agent reads of the five model saves', () => {
  it.each([
    ['/api/music/model', ['"balanced"', '"eleven"']],
    ['/api/image-model', ['"klein"', '"qwen-image"']],
    ['/api/effect-model', ['"small-sfx"', '"open-1"']],
    ['/api/models/draft', ['"s2.1-pro"', '"drama-3"']],
    ['/api/models/elevenlabs/draft', ['"eleven_v3"']],
  ])('%s names its model ids and where was is read', (path, ids) => {
    const body = matchAction('PUT', path)?.body ?? ''
    for (const word of ['{ model, was }', 'GET /api/models', ...ids]) {
      expect(body).toContain(word)
    }
  })
})
