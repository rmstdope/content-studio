// NAR-2: each take is checked with Whisper and made again until enough of its words are heard, and
// the manifest the game reads keeps its format and gets real word timings.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWav, writeWav } from '../../src/core/wav'
import { fish } from '../../src/server/test-support'
import type { Transcriber } from '../../src/services/transcriber'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const RATE = 1000

/** A silent mono WAV of `seconds`, which tells one take from another by its length. */
const wavOf = (seconds: number) =>
  writeWav({
    format: { channels: 1, sampleRate: RATE, bitsPerSample: 16 },
    data: new Uint8Array(seconds * RATE * 2),
  })

/** How long a WAV is, in seconds. */
const secondsOf = (wav: Uint8Array) => readWav(wav).data.length / (RATE * 2)

/**
 * What Whisper hears of a take that is mostly right: nine of the line's ten words ("as" is lost),
 * spoken unevenly, so no timing spread over the clip would give the same.
 */
const MOSTLY: [string, number, number][] = [
  ['The', 0.11, 0.2],
  ['old', 0.25, 0.6],
  ['café', 0.65, 1.3],
  ['door', 1.32, 1.5],
  ['creaked', 1.55, 2.4],
  ['open', 2.41, 2.55],
  ['night', 3.0, 3.1],
  ['fell', 3.15, 3.45],
  ['softly.', 3.5, 3.9],
]

/** The entry a line recorded earlier has, as the studio wrote it: it must stay byte for byte. */
const EARLIER = ` "a1": {
  "file": "a1.mp3",
  "speaker": "narrator",
  "duration": 2.0,
  "words": [
   {
    "word": "Before.",
    "start": 0.0,
    "end": 2.0
   }
  ]
 }`

describe('NAR-2: each take is checked with Whisper, and the game gets real word timings', () => {
  const spoken: number[] = []
  const heard: number[] = []
  /** Each take is a second longer than the one before: 3 s, 4 s, … */
  const takes: typeof fish = {
    ...fish,
    async tts() {
      const seconds = 3 + spoken.length
      spoken.push(seconds)
      return wavOf(seconds)
    },
  }
  /** Hears half the words of the first take, and all but one of any later one. */
  const whisper: Transcriber = {
    async transcribe(_model, path) {
      const seconds = secondsOf(readFileSync(path))
      heard.push(seconds)
      const words = seconds === 3 ? MOSTLY.slice(0, 5) : MOSTLY
      return [
        {
          start: 0,
          end: seconds,
          words: words.map(([word, start, end]) => ({ word: ` ${word}`, start, end })),
        },
      ]
    },
    close() {},
  }
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson(),
      'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
      'tts/act1/script.json': [
        { id: 'a1', speaker: 'narrator', text: 'Before.' },
        {
          id: 'a2',
          speaker: 'narrator',
          text: 'The old café door creaked open as night fell softly.',
        },
      ],
      'audio/act1/manifest.json': `{\n${EARLIER}\n}\n`,
      'audio/act1/a1.mp3': 'ID3-not-really-audio',
    },
    { fish: takes, transcriber: whisper },
  )
  const file = (path: string) => readFileSync(join(root, path))

  it('takes the line again until enough is heard, and writes it as the game reads it', async () => {
    const started = await page.send('POST', '/api/parts/act1/jobs', {
      speaker: null,
      keys: ['a2'],
      orphans: [],
    })
    expect(started.status).toBe(200)
    const { id } = (await started.json()) as { id: string }
    let job: { status: string; failed: unknown[] }
    for (const giveUp = Date.now() + 10_000; ;) {
      job = (await (await page.get(`/api/jobs/${id}`)).json()) as typeof job
      if (job.status !== 'running') break
      if (Date.now() > giveUp) throw new Error('the recording never ended')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(job).toMatchObject({ status: 'done', failed: [] })

    // The first take was heard too badly and made again; the second was enough, so no third.
    expect(spoken).toEqual([3, 4])
    expect(heard).toEqual([3, 4])

    // The game's own format, whole: one-space indents, floats, é escaped, the earlier entry as it
    // was. The times are Whisper's; "as", which it lost, lies between its neighbours.
    const word = (text: string, start: string, end: string) =>
      `   {\n    "word": "${text}",\n    "start": ${start},\n    "end": ${end}\n   }`
    const words = [
      word('The', '0.11', '0.2'),
      word('old', '0.25', '0.6'),
      word('caf\\u00e9', '0.65', '1.3'),
      word('door', '1.32', '1.5'),
      word('creaked', '1.55', '2.4'),
      word('open', '2.41', '2.55'),
      word('as', '2.55', '3.0'),
      word('night', '3.0', '3.1'),
      word('fell', '3.15', '3.45'),
      word('softly.', '3.5', '3.9'),
    ].join(',\n')
    expect(file('audio/act1/manifest.json').toString()).toBe(
      `{\n${EARLIER},\n "a2": {\n  "file": "a2.mp3",\n  "speaker": "narrator",\n` +
        `  "duration": 4.0,\n  "words": [\n${words}\n  ]\n }\n}\n`,
    )
    // The clip in the game is the take that was heard well enough.
    expect(secondsOf(file('audio/act1/a2.mp3'))).toBe(4)

    const { part } = (await (await page.get('/api/parts/act1')).json()) as {
      part: { lines: { key: string }[] }
    }
    expect(part.lines.find((line) => line.key === 'a2')).toMatchObject({
      status: 'ok',
      heard: 0.9,
    })
  })
})
