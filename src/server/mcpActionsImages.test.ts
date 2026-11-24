import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createContext } from './context'
import { studioRoutes } from './index'
import { ACTIONS, matchAction } from './mcpActions'
import { IMAGE_ACTIONS } from './mcpActionsImages'

describe('the Images steps an agent may do', () => {
  it('matches each step by method and route', () => {
    expect(matchAction('PATCH', '/api/image-style')?.page).toBe('Images')
    expect(matchAction('PATCH', '/api/images/door')?.page).toBe('Images')
    expect(matchAction('PUT', '/api/images/door/areas/chest')).not.toBeNull()
    expect(matchAction('PUT', '/api/images/door/effects')).not.toBeNull()
    expect(matchAction('PUT', '/api/images/door/zoom')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/takes')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/choose')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/copy')).not.toBeNull()
    expect(matchAction('POST', '/api/images/bring-all')).not.toBeNull()
    expect(matchAction('POST', '/api/image-acts/act1/make-all')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/patches/remake')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/patches/p1/choose')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/fine-tunes/use')).not.toBeNull()
    expect(matchAction('POST', '/api/images/door/unaccept')).not.toBeNull()
    expect(matchAction('POST', '/api/parts/act1/refresh')?.about).toContain('act')
  })

  it('refuses another method, and a path that climbs out', () => {
    expect(matchAction('GET', '/api/images/door/takes')).toBeNull()
    expect(matchAction('PUT', '/api/images/door/choose')).toBeNull()
    expect(matchAction('PUT', '/api/images/../door/zoom')).toBeNull()
  })

  it('asks for the confirmation the web page asks for, and for a clip deleted', () => {
    for (const [method, path] of [
      ['POST', '/api/images/door/choose'],
      ['POST', '/api/images/door/unchoose'],
      ['DELETE', '/api/images/door/takes/2'],
      ['POST', '/api/images/door/patches/p1/choose'],
      ['POST', '/api/images/door/patches/p1/unchoose'],
      ['DELETE', '/api/images/door/patches/p1/takes/2'],
      ['DELETE', '/api/images/door/fine-tunes/2'],
      ['POST', '/api/image-acts/act1/make-all'],
    ] as const) {
      expect(matchAction(method, path)?.confirm).toBeTruthy()
    }
    for (const [method, path] of [
      ['PATCH', '/api/images/door'],
      ['POST', '/api/images/door/takes'],
      ['PUT', '/api/images/door/zoom'],
      ['PATCH', '/api/image-style'],
    ] as const) {
      expect(matchAction(method, path)?.confirm).toBeUndefined()
    }
  })
})

describe('the registry as a whole', () => {
  it('lists no step twice', () => {
    const keys = ACTIONS.map((a) => `${a.method} ${a.path}`)
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([])
  })
})

describe('the Images steps, against the server', () => {
  const root = tempRepo({ 'content-studio.json': projectJson() })
  const routes = studioRoutes(
    createContext({ projectFile: join(root, 'content-studio.json'), port: 0 }),
  ) as unknown as Record<string, Record<string, unknown>>
  const changes = Object.entries(routes)
    .filter(([path]) => /^\/api\/(images|image-acts|image-style)(\/|$)/.test(path))
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) => method !== 'GET')
        .map((method) => `${method} ${path}`),
    )
    .sort()

  it('lists every change route of the page, and only those (Refresh is the part route)', () => {
    const listed = IMAGE_ACTIONS.filter((a) => a.path !== '/api/parts/:part/refresh')
    expect(listed.map((a) => `${a.method} ${a.path}`).sort()).toEqual(changes)
  })
})
