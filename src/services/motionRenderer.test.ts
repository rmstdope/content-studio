import { describe, expect, it } from 'bun:test'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { readMotionRenderer } from './motionRenderer'

const images = (extra: Record<string, unknown>) => ({
  from: { part: 'tts/{part}/images.json' },
  clips: 'img',
  manifest: 'img/manifest.json',
  ...extra,
})
const repo = (motion: string | undefined, files: Record<string, string> = {}) => {
  const root = tempRepo({
    'content-studio.json': projectJson({ images: images(motion ? { motion } : {}) }),
    ...files,
  })
  return join(root, 'content-studio.json')
}

describe('readMotionRenderer', () => {
  it('says so when the project names no renderer, or has no images', async () => {
    expect(await readMotionRenderer(repo(undefined))).toEqual({ named: false })
    const none = tempRepo({ 'content-studio.json': projectJson() })
    expect(await readMotionRenderer(join(none, 'content-studio.json'))).toEqual({ named: false })
  })

  it('bundles the renderer with the files it imports, TypeScript included', async () => {
    const root = repo('m/render.ts', {
      'm/render.ts': `import { EFFECT_TYPES } from './types'\nexport { EFFECT_TYPES }\nexport const createMotionScene = (): number => 1\n`,
      'm/types.ts': `export const EFFECT_TYPES: { type: string }[] = [{ type: 'dust' }]\n`,
    })
    const answer = await readMotionRenderer(root)
    if (!('code' in answer)) throw new Error(JSON.stringify(answer))
    const loaded = await import(
      `data:text/javascript;base64,${Buffer.from(answer.code).toString('base64')}`
    )
    expect(loaded.EFFECT_TYPES).toEqual([{ type: 'dust' }])
    expect(loaded.createMotionScene()).toBe(1)
  })

  it('says the file is not there', async () => {
    const answer = await readMotionRenderer(repo('m/render.ts'))
    expect(answer).toEqual({
      named: true,
      ok: false,
      file: 'm/render.ts',
      message: 'm/render.ts: the file is not there',
    })
  })

  it('reports a syntax error with its file and line', async () => {
    const answer = await readMotionRenderer(
      repo('m/render.ts', { 'm/render.ts': 'export const a = 1\nexport const b = (\n' }),
    )
    expect(answer).toMatchObject({ named: true, ok: false })
    if (!('message' in answer)) throw new Error('expected a failure')
    expect(answer.message).toMatch(/^m\/render\.ts: .+ \(line \d+\)$/)
  })

  it('names the file of an error in an imported file', async () => {
    const answer = await readMotionRenderer(
      repo('m/render.ts', {
        'm/render.ts': `import './bad'\n`,
        'm/bad.ts': 'const = 1\n',
      }),
    )
    if (!('message' in answer)) throw new Error('expected a failure')
    expect(answer.message.startsWith('m/bad.ts: ')).toBe(true)
  })

  it('refuses an import from outside the project', async () => {
    const outside = tempRepo({ 'secret.ts': 'export const s = 1\n' })
    const answer = await readMotionRenderer(
      repo('m/render.ts', {
        'm/render.ts': `import { s } from '${join(outside, 'secret.ts')}'\nexport const x = s\n`,
      }),
    )
    if (!('message' in answer)) throw new Error('expected a failure')
    expect(answer.ok).toBe(false)
    expect(answer.message).toContain('outside the project')
  })

  it('builds afresh each time, so an edit shows on the next ask', async () => {
    const file = repo('m/render.ts', { 'm/render.ts': 'export const v = 1\n' })
    const first = await readMotionRenderer(file)
    await Bun.write(join(file, '..', 'm/render.ts'), 'export const v = 2\n')
    const second = await readMotionRenderer(file)
    expect(first).not.toEqual(second)
  })
})

describe('a module linked in from outside the project', () => {
  it('is refused, as an import by its real path would be', async () => {
    const outside = tempRepo({ 'lib/shared.ts': 'export const s = 1\n' })
    const file = repo('m/render.ts', { 'm/render.ts': `export { s } from './linked/shared'\n` })
    symlinkSync(join(outside, 'lib'), join(file, '..', 'm', 'linked'))
    const answer = await readMotionRenderer(file)
    if (!('message' in answer)) throw new Error('expected a failure')
    expect(answer.message).toContain('outside the project')
  })
})
