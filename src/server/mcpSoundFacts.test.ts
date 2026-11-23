import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { writeWav } from '../core/wav'
import type { Transcriber } from '../services/transcriber'
import { startServer } from './index'

const realTmp = tmpdir()
const hasFfmpeg = Bun.which('ffmpeg') !== null

/** A second of a quiet tone, as bytes ffmpeg can read. */
function tone(): Uint8Array {
  const samples = new Int16Array(16000)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(0.2 * 32767 * Math.sin((2 * Math.PI * 440 * i) / 16000))
  }
  return writeWav({
    format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
    data: new Uint8Array(samples.buffer),
  })
}

/** The sample project's narration with its `generate.transcriber` set to "none". */
function noWhisper() {
  const narration = projectJson().narration as { generate?: object }
  return { ...narration, generate: { ...narration.generate, transcriber: 'none' } }
}

const asked: { language?: string }[] = []
const transcriber: Transcriber = {
  transcribe: async (_model, _path, language) => {
    asked.push({ language })
    return [{ start: 0, end: 1, words: [{ word: ' Once', start: 0, end: 1 }] }]
  },
  close() {},
}

describe.skipIf(!hasFfmpeg)('studio_fetch tells a sound in words', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
    'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
    'audio/act1/bad.mp3': 'ID3-not-really-audio',
  })
  writeFileSync(join(root, 'audio/act1/a.mp3'), tone())
  mkdirSync(join(root, 'audio/music'), { recursive: true })
  writeFileSync(join(root, 'audio/music/hall.mp3'), tone())
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    transcriber,
    elevenlabs: null,
  })
  afterAll(() => server.stop(true))
  let id = 0
  const fetchSound = async (path: string) => {
    const response = await fetch(new URL('/mcp', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name: 'studio_fetch', arguments: { path } },
      }),
    })
    return (await response.json()).result as {
      isError?: true
      content: { type: string; text: string }[]
    }
  }

  it('gives a line clip its length, loudness and the words heard, before the audio', async () => {
    const result = await fetchSound('/api/parts/act1/clips/a.mp3?language=sv')
    expect(result.isError).toBeUndefined()
    expect(result.content.map((c) => c.type)).toEqual(['text', 'text', 'audio'])
    expect(result.content[1]!.text).toMatch(
      /^Duration 1\.0 s, loudness -?\d+\.\d LUFS\. Whisper heard: "Once"$/,
    )
    // A project of one language is not told one, whatever the path asks.
    expect(asked.at(-1)).toEqual({ language: undefined })
  })

  it('gives a music clip its length and loudness, without asking Whisper', async () => {
    const before = asked.length
    const result = await fetchSound('/api/music/clips/hall.mp3')
    expect(result.content.map((c) => c.type)).toEqual(['text', 'text', 'audio'])
    expect(result.content[1]!.text).toMatch(/^Duration 1\.0 s, loudness -?\d+\.\d LUFS\.$/)
    expect(asked.length).toBe(before)
  })

  it('still hands over a file it cannot measure, and says so', async () => {
    const result = await fetchSound('/api/parts/act1/clips/bad.mp3')
    expect(result.isError).toBeUndefined()
    expect(result.content.map((c) => c.type)).toEqual(['text', 'text', 'audio'])
    expect(result.content[1]!.text).toBe(
      'Could not measure it: the file is not audio ffmpeg can read.',
    )
  })

  it('leaves no temporary file behind, measured or not', async () => {
    const own = mkdtempSync(join(realTmp, 'sound-facts-'))
    process.env.TMPDIR = own
    try {
      await fetchSound('/api/parts/act1/clips/a.mp3')
      await fetchSound('/api/parts/act1/clips/bad.mp3')
      await fetchSound('/api/music/clips/hall.mp3')
    } finally {
      process.env.TMPDIR = realTmp
    }
    expect(readdirSync(own)).toEqual([])
  })

  it('names no temporary file when it cannot measure', async () => {
    const result = await fetchSound('/api/parts/act1/clips/bad.mp3')
    expect(result.content[1]!.text).not.toContain('content-studio-measure')
  })
})

describe.skipIf(!hasFfmpeg)('studio_fetch when Whisper is switched off in the project', () => {
  const root = tempRepo({
    'content-studio.json': projectJson({ narration: noWhisper() }),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
    'audio/act1/manifest.json': { a: { file: 'a.mp3' } },
  })
  writeFileSync(join(root, 'audio/act1/a.mp3'), tone())
  const server = startServer({
    projectFile: join(root, 'content-studio.json'),
    port: 0,
    transcriber,
    elevenlabs: null,
  })
  afterAll(() => server.stop(true))

  it('says so, and does not ask Whisper', async () => {
    const before = asked.length
    const response = await fetch(new URL('/mcp', server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'studio_fetch', arguments: { path: '/api/parts/act1/clips/a.mp3' } },
      }),
    })
    const result = (await response.json()).result as { content: { text: string }[] }
    expect(result.content[1]!.text).toEndWith('Whisper is off (generate.transcriber is "none").')
    expect(asked.length).toBe(before)
  })
})
