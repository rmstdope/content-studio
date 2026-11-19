import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Encoder } from './audio'
import { createCleanJobs } from './cleanJobs'

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
      speakers: { narrator: { voice: 'v', clean: true } },
      pronounce: {},
    },
    'tts/act1/script.json': keys.map((id) => ({ id, speaker: 'narrator', text: id })),
    'audio/act1/manifest.json': Object.fromEntries(
      keys.map((k) => [k, { file: `${k}.mp3`, speaker: 'narrator', duration: 1, words: [] }]),
    ),
    'content-studio/narration/act1.lock.json': Object.fromEntries(
      keys.map((k, i) => [k, lockEntry(`T${i}`)]),
    ),
    ...Object.fromEntries(keys.map((k) => [`audio/act1/${k}.mp3`, `${k} as recorded`])),
  })
const decode = async (file: string) => ({ wav: readFileSync(file), seconds: 1 })
const upper: Encoder = async (wav, file, options) =>
  writeFileSync(file, options.clean ? Buffer.from(wav).toString().toUpperCase() : wav)
const clip = (root: string, k: string) => readFileSync(join(root, `audio/act1/${k}.mp3`), 'utf8')

describe('clean jobs', () => {
  it('cleans the lines not cleaned yet one at a time, then puts every one back', async () => {
    const root = repo()
    const jobs = createCleanJobs()
    const projectFile = join(root, 'content-studio.json')
    const started = await jobs.start(projectFile, 'narrator', undefined, 'clean', {
      encode: upper,
      decode,
    })
    expect(started).toMatchObject({ kind: 'clean', total: 3, status: 'running' })
    await jobs.settled('narrator', undefined)
    expect(jobs.get('narrator', undefined)).toMatchObject({ status: 'done', done: 3, failed: [] })
    expect(keys.map((k) => clip(root, k))).toEqual([
      'K1 AS RECORDED',
      'K2 AS RECORDED',
      'K3 AS RECORDED',
    ])
    // Nothing left to clean.
    expect(
      await jobs.start(projectFile, 'narrator', undefined, 'clean', { encode: upper, decode }),
    ).toEqual({ error: 'There are no lines to clean.' })
    await jobs.start(projectFile, 'narrator', undefined, 'putback', { encode: upper, decode })
    await jobs.settled('narrator', undefined)
    expect(keys.map((k) => clip(root, k))).toEqual([
      'k1 as recorded',
      'k2 as recorded',
      'k3 as recorded',
    ])
  })

  it('goes on past a line that fails, and says which and why', async () => {
    const root = repo()
    const jobs = createCleanJobs()
    const flaky: Encoder = async (wav, file, options) => {
      if (Buffer.from(wav).toString() === 'k2 as recorded')
        throw new Error('ffmpeg could not clean the voice')
      return upper(wav, file, options)
    }
    await jobs.start(join(root, 'content-studio.json'), 'narrator', undefined, 'clean', {
      encode: flaky,
      decode,
    })
    await jobs.settled('narrator', undefined)
    expect(jobs.get('narrator', undefined)).toMatchObject({
      status: 'done',
      done: 3,
      failed: [{ part: 'act1', key: 'k2', message: 'Line k2: ffmpeg could not clean the voice' }],
    })
    expect(clip(root, 'k2')).toBe('k2 as recorded')
    expect(clip(root, 'k3')).toBe('K3 AS RECORDED')
  })

  it('stops after the line in hand, leaving the rest uncleaned', async () => {
    const root = repo()
    const jobs = createCleanJobs()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const slow: Encoder = async (wav, file, options) => {
      if (Buffer.from(wav).toString() === 'k1 as recorded' && options.clean) await held
      return upper(wav, file, options)
    }
    await jobs.start(join(root, 'content-studio.json'), 'narrator', undefined, 'clean', {
      encode: slow,
      decode,
    })
    expect(jobs.stop('narrator', undefined)).toMatchObject({ status: 'stopping' })
    release()
    await jobs.settled('narrator', undefined)
    expect(jobs.get('narrator', undefined)).toMatchObject({ status: 'stopped', done: 1, total: 3 })
    expect(clip(root, 'k1')).toBe('K1 AS RECORDED')
    expect(clip(root, 'k2')).toBe('k2 as recorded')
  })

  it('refuses a second job for the same voice while one runs, and cannot stop a put back', async () => {
    const root = repo()
    const jobs = createCleanJobs()
    const projectFile = join(root, 'content-studio.json')
    await jobs.start(projectFile, 'narrator', undefined, 'clean', { encode: upper, decode })
    expect(
      await jobs.start(projectFile, 'narrator', undefined, 'clean', { encode: upper, decode }),
    ).toEqual({ error: 'This voice is being cleaned already.' })
    await jobs.settled('narrator', undefined)
    await jobs.start(projectFile, 'narrator', undefined, 'putback', { encode: upper, decode })
    expect(jobs.stop('narrator', undefined)).toMatchObject({ kind: 'putback', status: 'running' })
    await jobs.settled('narrator', undefined)
  })

  it('refuses to clean a voice whose switch is off', async () => {
    const root = repo()
    writeFileSync(
      join(root, 'content-studio/narration/cast.json'),
      JSON.stringify({ speakers: { narrator: { voice: 'v' } }, pronounce: {} }),
    )
    const jobs = createCleanJobs()
    expect(
      await jobs.start(join(root, 'content-studio.json'), 'narrator', undefined, 'clean', {
        encode: upper,
        decode,
      }),
    ).toEqual({ error: 'The clean-up is switched off for this voice.' })
  })

  it('stops cleaning when the switch is turned off meanwhile, leaving the rest as recorded', async () => {
    const root = repo()
    const jobs = createCleanJobs()
    const off = () =>
      writeFileSync(
        join(root, 'content-studio/narration/cast.json'),
        JSON.stringify({ speakers: { narrator: { voice: 'v' } }, pronounce: {} }),
      )
    const flipping: Encoder = async (wav, file, options) => {
      off()
      return upper(wav, file, options)
    }
    await jobs.start(join(root, 'content-studio.json'), 'narrator', undefined, 'clean', {
      encode: flipping,
      decode,
    })
    await jobs.settled('narrator', undefined)
    expect(jobs.get('narrator', undefined)).toMatchObject({ status: 'stopped', done: 1 })
    expect(clip(root, 'k2')).toBe('k2 as recorded')
  })

  it('lets only one of two starts at once go on', async () => {
    const root = repo()
    const jobs = createCleanJobs()
    const projectFile = join(root, 'content-studio.json')
    const [a, b] = await Promise.all([
      jobs.start(projectFile, 'narrator', undefined, 'clean', { encode: upper, decode }),
      jobs.start(projectFile, 'narrator', undefined, 'clean', { encode: upper, decode }),
    ])
    expect([a, b].filter((r) => 'error' in r)).toEqual([
      { error: 'This voice is being cleaned already.' },
    ])
    await jobs.settled('narrator', undefined)
  })
})
