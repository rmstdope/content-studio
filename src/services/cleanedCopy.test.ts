import { describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { Encoder } from './audio'
import { cleanedCopy, cleanedFile } from './cleanedCopy'

const leveled = projectJson({
  narration: {
    from: { part: 'tts/{part}/script.json' },
    clips: 'audio/{part}',
    manifest: 'audio/{part}/manifest.json',
    output: { lufs: -20 },
  },
})
const files = {
  'content-studio.json': leveled,
  'tts/act1/script.json': [{ id: 'k1', speaker: 'narrator', text: 'Hello.' }],
  'audio/act1/k1.mp3': 'the recorded line',
}

const projectFileOf = (root: string) => join(root, 'content-studio.json')
const decode = async () => ({ wav: new Uint8Array([1, 2, 3]), seconds: 1 })

/** An encoder that notes how it was asked, and writes what it was given. */
function watching() {
  const asked: { clean?: boolean; bitrate: string; lufs?: number | null }[] = []
  const encode: Encoder = async (wav, file, options) => {
    asked.push({ clean: options.clean, bitrate: options.bitrate, lufs: options.lufs })
    writeFileSync(file, wav)
  }
  return { asked, encode }
}

describe('cleanedCopy', () => {
  it('keeps a clip’s level in its copy, so the two are heard at the same loudness', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/manifest.json': {
        k1: { file: 'k1.mp3', speaker: 'narrator', duration: 1, words: [] },
      },
      'content-studio/narration/act1.lock.json': {
        k1: {
          fp: 'f',
          voice: 'v',
          model: 'm',
          hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
          level: 50,
          at: 'T1',
        },
      },
    })
    const gains: (number | undefined)[] = []
    const encode: Encoder = async (wav, file, options) => {
      gains.push(options.gainDb)
      writeFileSync(file, wav)
    }
    await cleanedCopy(projectFileOf(root), { part: 'act1', file: 'k1.mp3' }, { encode, decode })
    expect(gains[0]).toBeCloseTo(-6.02, 2)
  })

  it('makes a cleaned copy of a recorded line in the cache, encoded as the project encodes', async () => {
    const root = tempRepo(files)
    const { asked, encode } = watching()
    const made = await cleanedCopy(
      projectFileOf(root),
      { part: 'act1', file: 'k1.mp3' },
      { encode, decode },
    )
    if (!made?.ok) throw new Error(JSON.stringify(made))
    expect(made.name).toMatch(/^[0-9a-f]{16}\.mp3$/)
    expect(asked).toEqual([{ clean: true, bitrate: '64k', lufs: -20 }])
    expect(readFileSync(join(root, 'content-studio/cache/cleaned', made.name))).toEqual(
      Buffer.from([1, 2, 3]),
    )
    expect(await cleanedFile(projectFileOf(root), made.name)).toBe(
      join(root, 'content-studio/cache/cleaned', made.name),
    )
    // The game's clip is as it was, and nothing stray is left in the cache.
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('the recorded line')
    expect(readdirSync(join(root, 'content-studio/cache/cleaned'))).toEqual([made.name])
  })

  it('finds a clip’s level by the manifest, not by guessing its key from the file name', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/adopted.mp3': 'an adopted clip',
      'audio/act1/manifest.json': {
        k1: { file: 'adopted.mp3', speaker: 'narrator', duration: 1, words: [] },
      },
      'content-studio/narration/act1.lock.json': {
        k1: {
          fp: 'f',
          voice: 'v',
          model: 'm',
          hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
          level: 50,
          at: 'T1',
        },
      },
    })
    const gains: (number | undefined)[] = []
    const encode: Encoder = async (wav, file, options) => {
      gains.push(options.gainDb)
      writeFileSync(file, wav)
    }
    await cleanedCopy(
      projectFileOf(root),
      { part: 'act1', file: 'adopted.mp3' },
      { encode, decode },
    )
    expect(gains[0]).toBeCloseTo(-6.02, 2)
  })

  it('uses the copy it made before, until the clip changes', async () => {
    const root = tempRepo(files)
    const { asked, encode } = watching()
    const source = { part: 'act1', file: 'k1.mp3' }
    const first = await cleanedCopy(projectFileOf(root), source, { encode, decode })
    const again = await cleanedCopy(projectFileOf(root), source, { encode, decode })
    expect(again).toEqual(first)
    expect(asked).toHaveLength(1)
    const clip = join(root, 'audio/act1/k1.mp3')
    utimesSync(clip, new Date(2020, 1, 1), new Date(2020, 1, 1))
    const changed = await cleanedCopy(projectFileOf(root), source, { encode, decode })
    expect(changed?.ok && first?.ok && changed.name !== first.name).toBe(true)
    expect(asked).toHaveLength(2)
  })

  it('makes one from a character’s take', async () => {
    const root = tempRepo(files)
    const key = 'a'.repeat(16)
    mkdirSync(join(root, 'content-studio/cache/takes'), { recursive: true })
    writeFileSync(join(root, `content-studio/cache/takes/${key}.mp3`), 'take')
    const { asked, encode } = watching()
    const made = await cleanedCopy(projectFileOf(root), { take: key }, { encode, decode })
    expect(made?.ok).toBe(true)
    // Never levelled: the take it is heard beside is not.
    expect(asked[0]?.lufs).toBeNull()
  })

  it('says why it could not, as given, and leaves nothing behind', async () => {
    const root = tempRepo(files)
    const failing: Encoder = async () => {
      throw new Error('ffmpeg could not clean the voice: boom')
    }
    const made = await cleanedCopy(
      projectFileOf(root),
      { part: 'act1', file: 'k1.mp3' },
      { encode: failing, decode },
    )
    expect(made).toEqual({ ok: false, message: 'ffmpeg could not clean the voice: boom' })
    expect(existsSync(join(root, 'content-studio/cache/cleaned'))).toBe(false)
  })

  it('knows no clip or take that is not there, and serves nothing but its own copies', async () => {
    const root = tempRepo(files)
    const { encode } = watching()
    expect(
      await cleanedCopy(
        projectFileOf(root),
        { part: 'act1', file: 'nope.mp3' },
        { encode, decode },
      ),
    ).toBeNull()
    expect(
      await cleanedCopy(projectFileOf(root), { take: 'b'.repeat(16) }, { encode, decode }),
    ).toBeNull()
    expect(await cleanedFile(projectFileOf(root), '../../content-studio.json')).toBeNull()
    expect(await cleanedFile(projectFileOf(root), `${'c'.repeat(16)}.mp3`)).toBeNull()
  })
})
