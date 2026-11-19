import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { levelLine } from './levelLines'

const lockEntry = (at: string, level?: number) => ({
  fp: 'f',
  voice: 'v-n',
  model: 's2',
  hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
  ...(level === undefined ? {} : { level }),
  at,
})
const files = () => ({
  'content-studio.json': projectJson(),
  'tts/act1/script.json': [{ id: 'k1', speaker: 'narrator', text: 'One.' }],
  'audio/act1/manifest.json': {
    k1: { file: 'k1.mp3', speaker: 'narrator', duration: 1, words: [] },
  },
  'content-studio/narration/act1.lock.json': { k1: lockEntry('T1') },
  'audio/act1/k1.mp3': 'one',
})
/** A gain that only notes itself in the clip: `[-6.0]` after what was there. */
const gain = async (file: string, db: number) => {
  writeFileSync(file, `${readFileSync(file, 'utf8')}[${db.toFixed(1)}]`)
}
const lockOf = (root: string) =>
  JSON.parse(readFileSync(join(root, 'content-studio/narration/act1.lock.json'), 'utf8'))

describe('levelLine', () => {
  it('sets the clip by the gain from its level to the new one, and notes the level in the lock', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    expect(await levelLine(projectFile, 'act1', undefined, 'k1', 50, { gain })).toEqual({
      ok: true,
    })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one[-6.0]')
    expect(lockOf(root).k1.level).toBe(50)
    // From 50% to 100%: the same gain back, and no level is kept.
    await levelLine(projectFile, 'act1', undefined, 'k1', 100, { gain })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one[-6.0][6.0]')
    expect('level' in lockOf(root).k1).toBe(false)
    expect(lockOf(root).k1.at).toBe('T1')
  })

  it('leaves a clip already at the level as it is', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    await levelLine(projectFile, 'act1', undefined, 'k1', 60, { gain })
    expect(await levelLine(projectFile, 'act1', undefined, 'k1', 60, { gain })).toEqual({
      ok: true,
    })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one[-4.4]')
  })

  it('leaves the clip and the lock alone when the gain fails, and no temporary file behind', async () => {
    const root = tempRepo(files())
    const failing = async () => {
      throw new Error('ffmpeg could not level the clip')
    }
    const result = await levelLine(join(root, 'content-studio.json'), 'act1', undefined, 'k1', 60, {
      gain: failing,
    })
    expect(result).toEqual({ ok: false, message: 'Line k1: ffmpeg could not level the clip' })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one')
    expect('level' in lockOf(root).k1).toBe(false)
    expect(readdirSync(join(root, 'audio/act1')).sort()).toEqual(['k1.mp3', 'manifest.json'])
  })

  it('says so for a line with no clip in the game', async () => {
    const root = tempRepo(files())
    const result = await levelLine(
      join(root, 'content-studio.json'),
      'act1',
      undefined,
      'nope',
      60,
      {
        gain,
      },
    )
    expect(result).toEqual({ ok: false, message: 'The line has no clip in the game.' })
  })

  it('keeps level in one place in the lock entry, whatever the entry had', async () => {
    const root = tempRepo({
      ...files(),
      'content-studio/narration/act1.lock.json': {
        k1: { ...lockEntry('T1'), adopted: true, takes: 2 },
      },
    })
    await levelLine(join(root, 'content-studio.json'), 'act1', undefined, 'k1', 60, { gain })
    expect(Object.keys(lockOf(root).k1)).toEqual([
      'fp',
      'voice',
      'model',
      'hashes',
      'takes',
      'level',
      'adopted',
      'at',
    ])
  })
})
