import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Encoder } from './audio'
import { removeOrphans } from './narration'
import { cleanLine, cleanedLinesOf, originalClipFile, putBackLine } from './cleanLines'

const lockEntry = (at: string) => ({
  fp: 'f',
  voice: 'v-n',
  model: 's2',
  hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
  at,
})
const files = (clean = true) => ({
  'content-studio.json': projectJson(),
  'content-studio/narration/cast.json': {
    speakers: {
      narrator: { voice: 'v-n', ...(clean ? { clean: true } : {}) },
      mira: { voice: 'v-m' },
    },
    pronounce: {},
  },
  'tts/act1/script.json': [
    { id: 'k1', speaker: 'narrator', text: 'One.' },
    { id: 'k2', speaker: 'narrator', text: 'Two.' },
    { id: 'k3', speaker: 'mira', text: 'Three.' },
    { id: 'k4', speaker: 'narrator', text: 'Four, not recorded.' },
  ],
  'audio/act1/manifest.json': {
    k1: { file: 'k1.mp3', speaker: 'narrator', duration: 1, words: [] },
    k2: { file: 'k2.mp3', speaker: 'narrator', duration: 1, words: [] },
    k3: { file: 'k3.mp3', speaker: 'mira', duration: 1, words: [] },
  },
  'content-studio/narration/act1.lock.json': {
    k1: lockEntry('T1'),
    k2: lockEntry('T2'),
    k3: lockEntry('T3'),
  },
  'audio/act1/k1.mp3': 'one as recorded',
  'audio/act1/k2.mp3': 'two as recorded',
  'audio/act1/k3.mp3': 'three as recorded',
})
const decode = async (file: string) => ({ wav: readFileSync(file), seconds: 1 })
/** An encoder that "cleans" by upper-casing what it is given when asked to. */
const encode: Encoder = async (wav, file, options) => {
  const text = Buffer.from(wav).toString()
  writeFileSync(file, options.clean ? text.toUpperCase() : text)
}
const deps = { encode, decode }

describe('cleaning a line already in the game', () => {
  it('keeps the original, records it against the clip’s lock time, and replaces the clip', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    const lockBefore = readFileSync(join(root, 'content-studio/narration/act1.lock.json'), 'utf8')
    expect(await cleanLine(projectFile, 'act1', undefined, 'k1', deps)).toEqual({ ok: true })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('ONE AS RECORDED')
    expect(readFileSync(join(root, 'content-studio/narration/originals/act1/k1.mp3'), 'utf8')).toBe(
      'one as recorded',
    )
    expect(
      JSON.parse(readFileSync(join(root, 'content-studio/narration/act1.cleaned.json'), 'utf8')),
    ).toEqual({ k1: { at: 'T1', original: 'k1.mp3' } })
    // The game's lock is the studio's account of what a clip was made from: unchanged.
    expect(readFileSync(join(root, 'content-studio/narration/act1.lock.json'), 'utf8')).toBe(
      lockBefore,
    )
    // No hidden temporary file is left in the clips folder.
    expect(readdirSync(join(root, 'audio/act1')).sort()).toEqual([
      'k1.mp3',
      'k2.mp3',
      'k3.mp3',
      'manifest.json',
    ])
  })

  it('leaves the clip alone when the clean-up fails', async () => {
    const root = tempRepo(files())
    const failing: Encoder = async () => {
      throw new Error('ffmpeg could not clean the voice')
    }
    const result = await cleanLine(join(root, 'content-studio.json'), 'act1', undefined, 'k1', {
      encode: failing,
      decode,
    })
    expect(result).toEqual({ ok: false, message: 'ffmpeg could not clean the voice' })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one as recorded')
    expect(existsSync(join(root, 'content-studio/narration/originals'))).toBe(false)
    expect(existsSync(join(root, 'content-studio/narration/act1.cleaned.json'))).toBe(false)
  })

  it('does not clean a clip twice, which would lose the original', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    await cleanLine(projectFile, 'act1', undefined, 'k1', deps)
    expect(await cleanLine(projectFile, 'act1', undefined, 'k1', deps)).toEqual({ ok: true })
    expect(readFileSync(join(root, 'content-studio/narration/originals/act1/k1.mp3'), 'utf8')).toBe(
      'one as recorded',
    )
  })

  it('puts the original back and forgets the record and the copy', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    await cleanLine(projectFile, 'act1', undefined, 'k1', deps)
    expect(await putBackLine(projectFile, 'act1', undefined, 'k1')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one as recorded')
    expect(existsSync(join(root, 'content-studio/narration/originals/act1/k1.mp3'))).toBe(false)
    expect(
      JSON.parse(readFileSync(join(root, 'content-studio/narration/act1.cleaned.json'), 'utf8')),
    ).toEqual({})
    // Again, as after a crash part-way: nothing to do, nothing lost.
    expect(await putBackLine(projectFile, 'act1', undefined, 'k1')).toEqual({ ok: true })
  })

  it('does not put an old original over a clip recorded again since', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    await cleanLine(projectFile, 'act1', undefined, 'k1', deps)
    // A new recording: a new clip and a new lock time.
    writeFileSync(join(root, 'audio/act1/k1.mp3'), 'one recorded again')
    writeFileSync(
      join(root, 'content-studio/narration/act1.lock.json'),
      JSON.stringify({ k1: lockEntry('T9') }),
    )
    expect(await putBackLine(projectFile, 'act1', undefined, 'k1')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('one recorded again')
    expect(existsSync(join(root, 'content-studio/narration/originals/act1/k1.mp3'))).toBe(false)
  })
})

describe('originalClipFile', () => {
  it('finds the kept original of a cleaned line only, and not once the clip is recorded again', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    expect(await originalClipFile(projectFile, 'act1', 'k1.mp3')).toBeNull()
    await cleanLine(projectFile, 'act1', undefined, 'k1', deps)
    expect(await originalClipFile(projectFile, 'act1', 'k1.mp3')).toBe(
      join(root, 'content-studio/narration/originals/act1/k1.mp3'),
    )
    expect(await originalClipFile(projectFile, 'act1', '../k1.mp3')).toBeNull()
    writeFileSync(
      join(root, 'content-studio/narration/act1.lock.json'),
      JSON.stringify({ k1: lockEntry('T9') }),
    )
    expect(await originalClipFile(projectFile, 'act1', 'k1.mp3')).toBeNull()
  })
})

describe('cleanedLinesOf', () => {
  it('counts the speaker’s lines in the game, and which of them are cleaned', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    await cleanLine(projectFile, 'act1', undefined, 'k1', deps)
    const found = await cleanedLinesOf(projectFile, 'narrator')
    expect(found).toEqual({
      total: 2,
      cleaned: 1,
      problem: null,
      lines: [
        { part: 'act1', key: 'k1', file: 'k1.mp3', cleaned: true },
        { part: 'act1', key: 'k2', file: 'k2.mp3', cleaned: false },
      ],
    })
  })

  it('says when the record of cleaned lines cannot be read, instead of counting every line as not cleaned', async () => {
    const root = tempRepo({
      ...files(),
      'content-studio/narration/act1.cleaned.json': '{ not json',
    })
    const found = await cleanedLinesOf(join(root, 'content-studio.json'), 'narrator')
    expect(found.problem).toContain('act1.cleaned.json')
  })
})

describe('what is kept of a cleaned line', () => {
  it('goes when the line is removed as an orphan', async () => {
    const root = tempRepo(files())
    const projectFile = join(root, 'content-studio.json')
    await cleanLine(projectFile, 'act1', undefined, 'k1', deps)
    // The dialog no longer has k1.
    writeFileSync(
      join(root, 'tts/act1/script.json'),
      JSON.stringify([{ id: 'k2', speaker: 'narrator', text: 'Two.' }]),
    )
    expect(await removeOrphans(projectFile, 'act1', ['k1'])).toBe(1)
    expect(existsSync(join(root, 'content-studio/narration/originals/act1/k1.mp3'))).toBe(false)
    expect(
      JSON.parse(readFileSync(join(root, 'content-studio/narration/act1.cleaned.json'), 'utf8')),
    ).toEqual({})
  })
})
