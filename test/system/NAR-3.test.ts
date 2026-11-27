// NAR-3: the person can set a line's delivery cue, a character's style and speed, pronunciations
// and the words that sound the same; the lines these change then show as out of date.
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWav } from '../../src/core/wav'
import { fish } from '../../src/server/test-support'
import type { FishClient } from '../../src/services/fish'
import { projectJson } from '../helpers'
import { jobEnded, startStudio, wavOf } from './studio'

/** The script, and how long each line's take is, which is how Whisper tells the takes apart. */
const LINES = [
  { id: 'a1', speaker: 'narrator', text: 'Elior opened the door.', seconds: 1 },
  { id: 'a2', speaker: 'narrator', text: 'Night fell.', seconds: 2 },
  { id: 'g1', speaker: 'guide', text: 'Follow me.', seconds: 3 },
  { id: 'g2', speaker: 'guide', text: 'Welcome to Zorblax.', seconds: 4 },
]

/** What Whisper hears of each line: all of it, but for a made-up name it spells its own way. */
const HEARD = ['Elior opened the door.', 'Night fell.', 'Follow me.', 'Welcome to Sorblacks.']

// One walk over one studio: each test goes on from what the ones before it made.
describe('NAR-3: what the person sets puts the lines it changes out of date', () => {
  /** What Fish has been asked to say since it was last looked at. */
  const asked: Parameters<FishClient['tts']>[0][] = []
  let takes = 0
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson(),
      'content-studio/narration/cast.json': {
        speakers: { narrator: { voice: 'v1' }, guide: { voice: 'v2' } },
      },
      'tts/act1/script.json': LINES.map(({ seconds: _, ...line }) => line),
    },
    {
      fish: {
        ...fish,
        async tts(request) {
          asked.push(request)
          // A line is known by its last word, whatever cue or pronunciation is put on it.
          const line = LINES.findIndex((l) => request.text.includes(l.text.split(' ').at(-1)!))
          if (line < 0) throw new Error(`no line of the script is in "${request.text}"`)
          // Each take sounds unlike the ones before it, past the WAV's header.
          return wavOf(LINES[line]!.seconds).fill(++takes, 44)
        },
      },
      transcriber: {
        async transcribe(_model, path) {
          const seconds = readWav(readFileSync(path)).data.length / 2000
          const words = HEARD[LINES.findIndex((l) => l.seconds === seconds)]!.split(' ')
          const each = seconds / words.length
          return [
            {
              start: 0,
              end: seconds,
              words: words.map((word, i) => ({
                word: ` ${word}`,
                start: i * each,
                end: (i + 1) * each,
              })),
            },
          ]
        },
        close() {},
      },
    },
  )
  const file = (path: string) => readFileSync(join(root, path), 'utf8')
  const json = (path: string) => JSON.parse(file(path)) as unknown

  /** Everything the game has of the narration: its manifest and the clips. */
  const game = () =>
    ['manifest.json', ...LINES.map((l) => `${l.id}.mp3`)].map((name) =>
      readFileSync(join(root, 'audio/act1', name)).toString('base64'),
    )

  /** Each line as the part's page shows it: its status, and why when it is out of date. */
  async function shown(): Promise<Record<string, string>> {
    const { part } = (await (await page.get('/api/parts/act1')).json()) as {
      part: { lines: { key: string; status: string; reasons: string[] }[] }
    }
    return Object.fromEntries(part.lines.map((l) => [l.key, [l.status, ...l.reasons].join(' ')]))
  }

  /**
   * Saves a setting as the page does. Nothing the game has changes by it: only recording does.
   * Answers what the part's page then shows.
   */
  async function set(path: string, body: unknown): Promise<Record<string, string>> {
    const before = game()
    const saved = await page.send('PATCH', path, body)
    expect(await saved.json()).toEqual({ ok: true })
    expect(game()).toEqual(before)
    expect(asked).toEqual([])
    return shown()
  }

  /**
   * Records what the part's plan offers, with the weak lines too when the person ticks that. The
   * game gets new clips for those lines and keeps the others.
   * Answers what Fish was asked to say, one request for each line, in the script's order.
   */
  async function record(retakeWeak = false) {
    const planned = await page.get(`/api/parts/act1/plan${retakeWeak ? '?weak=1' : ''}`)
    const { plan } = (await planned.json()) as { plan: { keys: string[] } }
    const before = existsSync(join(root, 'audio/act1/manifest.json')) ? game() : []
    const started = await page.send('POST', '/api/parts/act1/jobs', {
      speaker: null,
      keys: plan.keys,
      orphans: [],
      retakeWeak,
    })
    expect(started.status).toBe(200)
    const { id } = (await started.json()) as { id: string }
    expect(await jobEnded(page, id)).toMatchObject({ status: 'done', failed: [] })
    // After the manifest, `game` has a clip for each line, in the script's order.
    const after = game().slice(1)
    expect(LINES.filter((_, i) => after[i] !== before[i + 1]).map((l) => l.id)).toEqual(
      [...plan.keys].sort(),
    )
    return asked.splice(0).sort((a, b) => a.text.localeCompare(b.text))
  }

  /** Every line up to date, but the one whose name Whisper does not know. */
  const settled = { a1: 'ok', a2: 'ok', g1: 'ok', g2: 'weak' }

  it('starts with every line recorded and up to date', async () => {
    await record()
    expect(await shown()).toEqual(settled)
  })

  it('sets a line’s delivery cue: that line alone is out of date', async () => {
    expect(await set('/api/parts/act1/cues/a2', { cue: '[whispering]' })).toEqual({
      ...settled,
      a2: 'stale cue',
    })
    expect(json('content-studio/narration/act1.edits.json')).toMatchObject({
      cues: { a2: '[whispering]' },
    })

    const said = await record()
    expect(said.map((r) => r.text)).toEqual(['[whispering] Night fell.'])
    expect(await shown()).toEqual(settled)
  })

  it('sets a character’s style: the lines without a cue of their own are out of date', async () => {
    expect(await set('/api/characters/narrator', { style: '[solemn]' })).toEqual({
      ...settled,
      a1: 'stale cue',
    })
    expect(json('content-studio/narration/cast.json')).toMatchObject({
      speakers: { narrator: { style: '[solemn]' } },
    })

    const said = await record()
    expect(said.map((r) => r.text)).toEqual(['[solemn] Elior opened the door.'])
    expect(await shown()).toEqual(settled)
  })

  it('sets a character’s speed: all of that character’s lines are out of date', async () => {
    expect(await set('/api/characters/narrator', { speed: 1.2 })).toEqual({
      ...settled,
      a1: 'stale settings',
      a2: 'stale settings',
    })
    expect(json('content-studio/narration/cast.json')).toMatchObject({
      speakers: { narrator: { speed: 1.2 } },
    })

    const said = await record()
    expect(said.map((r) => [r.text, r.speed])).toEqual([
      ['[solemn] Elior opened the door.', 1.2],
      ['[whispering] Night fell.', 1.2],
    ])
    expect(await shown()).toEqual(settled)
  })

  it('sets a pronunciation: the lines holding the word are out of date', async () => {
    expect(await set('/api/pronounce', { table: [['Elior', 'El-ee-or']], was: [] })).toEqual({
      ...settled,
      a1: 'stale pronunciation',
    })
    expect(json('content-studio/narration/cast.json')).toMatchObject({
      pronounce: { en: { Elior: 'El-ee-or' } },
    })

    const said = await record()
    expect(said.map((r) => r.text)).toEqual(['[solemn] El-ee-or opened the door.'])
    expect(await shown()).toEqual(settled)
  })

  // These change how a take is heard, not how it sounds: no clip goes out of date by them, and
  // they count from the next take on.
  it('sets words that sound the same: the next take is heard with them', async () => {
    expect(await set('/api/sound-alike', { groups: [['Zorblax', 'Sorblacks']], was: [] })).toEqual(
      settled,
    )
    expect(json('content-studio.json')).toMatchObject({
      narration: { generate: { soundAlike: { en: [['Zorblax', 'Sorblacks']] } } },
    })

    const said = await record(true)
    expect(said.map((r) => r.text)).toEqual(['Welcome to Zorblax.'])
    expect(await shown()).toEqual({ ...settled, g2: 'ok' })
  })
})
