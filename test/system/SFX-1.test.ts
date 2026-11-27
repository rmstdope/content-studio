// SFX-1: each sound effect the game lists can be made as takes with a local model, from a
// description the person can reword. The person chooses a take for the game; a looping effect loops
// without a seam.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { EffectTakesView } from '../../src/core/effectTakes'
import type { ProjectSummary } from '../../src/core/summary'
import { writeWav } from '../../src/core/wav'
import { ffmpegEncoder } from '../../src/services/audio'
import type { EffectRequest } from '../../src/services/effects'
import { createFakeEffects } from '../../src/services/effectsFake'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const RATE = 44_100

/** How loud the model's tones are, as a sample's value. */
const LOUD = 8000

/**
 * A steady tone. At 100.125 Hz it is half a cycle out after the 4 seconds the game loops, so a
 * take merely cut there jumps from one end of its swing to the other when it goes round.
 */
function tone(seconds: number) {
  const samples = Int16Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    Math.round(LOUD * Math.cos((2 * Math.PI * 100.125 * i) / RATE)),
  )
  const format = { channels: 1, sampleRate: RATE, bitsPerSample: 16 }
  return writeWav({ format, data: new Uint8Array(samples.buffer) })
}

/** The samples of the MP3 at `path`, decoded to one channel, as a player of the game gets them. */
function decoded(path: string): Int16Array {
  const run = Bun.spawnSync(
    [
      'ffmpeg',
      '-loglevel',
      'error',
      '-i',
      path,
      '-ac',
      '1',
      '-ar',
      String(RATE),
      '-f',
      's16le',
      '-',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return new Int16Array(new Uint8Array(run.stdout).buffer)
}

describe.skipIf(Bun.which('ffmpeg') === null)('SFX-1: a sound effect is made and chosen', () => {
  // ffmpeg encodes each chosen take for real.
  setDefaultTimeout(30_000)

  const list = [
    { id: 'coins', text: 'Coins spill on stone', seconds: 3 },
    { id: 'wind', text: 'Wind howls', seconds: 4, loops: true },
  ]
  /** What the local model was asked for, in turn. */
  const asked: (EffectRequest & { model: string })[] = []
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson({
        effects: {
          from: { shared: 'tts/effects.json' },
          clips: 'audio/effects',
          manifest: 'audio/effects/manifest.json',
        },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/effects.json': list,
    },
    {
      effects: {
        ...createFakeEffects(0),
        // A one-shot's sound stops before the length asked, each take at its own point, which tells
        // them apart; a loop's lasts all of it.
        generate: async (request) => {
          asked.push(request)
          const seconds = request.loops ? request.seconds : asked.length * 0.5
          return { wav: tone(seconds), seed: request.seed }
        },
      },
      // The real encoder in place of the stand-in: ffmpeg is no provider or model, and the game
      // loops the MP3, which must not gain silence or a click where it goes round.
      encode: ffmpegEncoder,
    },
  )

  /** Every file of the game with its content, but for the studio's cache. */
  function game(): Record<string, string> {
    const paths = (readdirSync(root, { recursive: true }) as string[]).sort()
    return Object.fromEntries(
      paths
        .filter((path) => !path.startsWith('content-studio/cache/'))
        .filter((path) => statSync(join(root, path)).isFile())
        .map((path) => [path, readFileSync(join(root, path)).toString('base64')]),
    )
  }
  const before = game()
  const manifest = () =>
    JSON.parse(readFileSync(join(root, 'audio/effects/manifest.json'), 'utf8')) as unknown

  /** The effects as the Sound effects page lists them. */
  async function rows() {
    const response = await page.get('/api/project')
    const { summary } = (await response.json()) as { summary: ProjectSummary }
    return summary.effects!.rows
  }

  /** Asks for `count` takes of an effect and waits for them, as its page does. */
  async function make(id: string, count: number) {
    expect((await page.send('POST', `/api/effects/${id}/takes`, { count })).status).toBe(200)
    for (const giveUp = Date.now() + 10_000; ;) {
      const view = (await (await page.get(`/api/effects/${id}/takes`)).json()) as EffectTakesView
      if (view.making.length === 0) {
        expect(view.failed).toEqual([])
        expect(view.takes).toHaveLength(count)
        return view.takes
      }
      if (Date.now() > giveUp) throw new Error(`${id}: the takes never came`)
      await Bun.sleep(10)
    }
  }

  async function choose(id: string, file: string) {
    const chosen = await page.send('POST', `/api/effects/${id}/choose`, { file })
    expect([chosen.status, await chosen.json()]).toEqual([200, { ok: true }])
  }

  it('makes takes of each listed effect with a local model, from the words the person reworded', async () => {
    expect((await rows()).map((row) => row.id)).toEqual(['coins', 'wind'])

    const reworded = await page.send('PATCH', '/api/effects/coins', {
      description: 'A few coins on glass',
    })
    expect(reworded.status).toBe(200)
    await make('coins', 2)
    await make('wind', 1)

    expect(asked.map(({ model, prompt }) => [model, prompt])).toEqual([
      ['small-sfx', 'A few coins on glass'],
      ['small-sfx', 'A few coins on glass'],
      ['small-sfx', 'Wind howls'],
    ])
  })

  it('gives the game the take the person chooses', async () => {
    const view = (await (await page.get('/api/effects/coins/takes')).json()) as EffectTakesView
    const [first, second] = view.takes
    expect(first!.seconds).not.toBe(second!.seconds)

    // One take and then the other: the game has whichever was chosen last.
    for (const take of [first!, second!]) {
      await choose('coins', take.file)

      expect(manifest()).toEqual({ coins: { file: 'coins.mp3', duration: take.seconds } })
      const clip = decoded(join(root, 'audio/effects/coins.mp3'))
      expect(clip.length / RATE).toBeCloseTo(take.seconds, 2)
      expect((await rows())[0]).toMatchObject({ id: 'coins', status: 'chosen' })
    }
  })

  it('gives the game a looping effect that goes round without a seam', async () => {
    const view = (await (await page.get('/api/effects/wind/takes')).json()) as EffectTakesView

    await choose('wind', view.takes[0]!.file)

    expect(manifest()).toMatchObject({ wind: { file: 'wind.mp3', duration: 4 } })
    const clip = decoded(join(root, 'audio/effects/wind.mp3'))
    // Exactly the length the game asked for: nothing is added to the end it goes round from.
    expect(clip.length).toBe(4 * RATE)
    // The end and the start as they are heard one after the other, 20 ms of each.
    const edge = RATE / 50
    const round = [...clip.slice(-edge), ...clip.slice(0, edge)]
    // Both sides sound: no silence covers the join.
    for (const side of [round.slice(0, edge), round.slice(edge)]) {
      expect(Math.max(...side.map(Math.abs))).toBeGreaterThan(LOUD / 2)
    }
    // And no jump: merely cut, the clip steps about 10 000 here. The tone moves about 115 from one sample
    // to the next, and the MP3, which encodes each end without the other, is out by up to 1500.
    const steps = round.slice(1).map((sample, i) => Math.abs(sample - round[i]!))
    expect(Math.max(...steps)).toBeLessThan(4000)
  })

  it('changes only the effects’ clips and manifest and the studio’s own files', () => {
    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()

    expect(changed).toEqual([
      'audio/effects/coins.mp3',
      'audio/effects/manifest.json',
      'audio/effects/wind.mp3',
      'content-studio/effects/edits.json',
      'content-studio/effects/lock.json',
    ])
  })
})
