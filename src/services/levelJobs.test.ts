import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { createLevelJobs } from './levelJobs'

const lockEntry = (at: string) => ({
  fp: 'f',
  voice: 'v',
  model: 's2',
  hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
  at,
})
const keys = ['k1', 'k2', 'k3']
const repo = () =>
  tempRepo({
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { narrator: { voice: 'v' }, mira: { voice: 'm' } },
      pronounce: {},
    },
    'tts/act1/script.json': [
      ...keys.map((id) => ({ id, speaker: 'narrator', text: id })),
      { id: 'k4', speaker: 'mira', text: 'k4' },
    ],
    'audio/act1/manifest.json': Object.fromEntries(
      [...keys, 'k4'].map((k) => [
        k,
        { file: `${k}.mp3`, speaker: k === 'k4' ? 'mira' : 'narrator', duration: 1, words: [] },
      ]),
    ),
    'content-studio/narration/act1.lock.json': Object.fromEntries(
      [...keys, 'k4'].map((k, i) => [k, lockEntry(`T${i}`)]),
    ),
    ...Object.fromEntries([...keys, 'k4'].map((k) => [`audio/act1/${k}.mp3`, k])),
  })
const gain = async (file: string, db: number) => {
  const text = readFileSync(file, 'utf8')
  if (text.startsWith('k2') && db < 0) throw new Error('ffmpeg could not level the clip')
  writeFileSync(file, `${text}[${db.toFixed(1)}]`)
}
const clip = (root: string, k: string) => readFileSync(join(root, `audio/act1/${k}.mp3`), 'utf8')

describe('level jobs', () => {
  it('sets the voice’s lines to the level, one at a time, and no one else’s', async () => {
    const root = repo()
    const jobs = createLevelJobs()
    const projectFile = join(root, 'content-studio.json')
    const started = await jobs.start(projectFile, 'narrator', undefined, 200, { gain })
    expect(started).toMatchObject({ level: 200, total: 3, done: 0, status: 'running' })
    await jobs.settled('narrator', undefined)
    expect(jobs.get('narrator', undefined)).toMatchObject({ status: 'done', done: 3, failed: [] })
    expect(keys.map((k) => clip(root, k))).toEqual(['k1[6.0]', 'k2[6.0]', 'k3[6.0]'])
    expect(clip(root, 'k4')).toBe('k4')
    // Every line is at the level: nothing to do.
    expect(await jobs.start(projectFile, 'narrator', undefined, 200, { gain })).toBeNull()
  })

  it('notes a line that failed and goes on with the rest, which can be set again after', async () => {
    const root = repo()
    const jobs = createLevelJobs()
    const projectFile = join(root, 'content-studio.json')
    await jobs.start(projectFile, 'narrator', undefined, 50, { gain })
    await jobs.settled('narrator', undefined)
    expect(jobs.get('narrator', undefined)).toMatchObject({
      status: 'done',
      done: 3,
      failed: [{ part: 'act1', key: 'k2', message: 'Line k2: ffmpeg could not level the clip' }],
    })
    expect(clip(root, 'k3')).toBe('k3[-6.0]')
    // Again: only the line that is still at 100% is done.
    const again = await jobs.start(projectFile, 'narrator', undefined, 50, { gain: async () => {} })
    expect(again).toMatchObject({ total: 1 })
  })

  it('does not start a second job for a voice that has one going', async () => {
    const root = repo()
    const jobs = createLevelJobs()
    const projectFile = join(root, 'content-studio.json')
    const first = jobs.start(projectFile, 'narrator', undefined, 60, { gain })
    const second = await jobs.start(projectFile, 'narrator', undefined, 70, { gain })
    await first
    expect(second).toEqual({ error: 'This voice is being set to a level already.' })
    await jobs.settled('narrator', undefined)
  })
})
