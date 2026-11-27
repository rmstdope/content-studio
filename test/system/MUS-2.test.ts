// MUS-2: a take can be trimmed and faded before it goes to the game.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MusicTakesView } from '../../src/core/musicTake'
import { readWav } from '../../src/core/wav'
import { ffmpegEncoder } from '../../src/services/audio'
import { createMusicRouter, type MusicGenerator } from '../../src/services/music'
import { projectJson } from '../helpers'
import { decoded, RATE, tone } from './sound'
import { startStudio } from './studio'

/** How loud the 50 ms around `at` seconds are: the root mean square of the samples. */
function loudness(samples: Int16Array, at: number): number {
  const window = samples.subarray(Math.round((at - 0.025) * RATE), Math.round((at + 0.025) * RATE))
  return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length)
}

describe.skipIf(Bun.which('ffmpeg') === null)(
  'MUS-2: a take is trimmed and faded before it goes to the game',
  () => {
    // ffmpeg levels and encodes the chosen take for real.
    setDefaultTimeout(30_000)

    /** A model whose take is silent for a second, sounds for two and is silent again. */
    const model: MusicGenerator = {
      ready: () => ({ ok: true }),
      installed: () => true,
      async generate(request) {
        return { wav: tone(400, request.seconds, 3, 1), seed: request.seed }
      },
      close() {},
    }

    const { root, page } = startStudio(
      {
        'content-studio.json': projectJson({
          music: {
            from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
            clips: 'audio/music',
            manifest: 'audio/music/manifest.json',
          },
        }),
        'content-studio/narration/cast.json': { speakers: {} },
        'tts/act1/music.json': [],
        'tts/stingers.json': [
          { id: 'victory', title: 'Victory', text: 'Short brass fanfare', seconds: 5 },
        ],
      },
      {
        music: createMusicRouter({
          acestep: model,
          'stable-audio': model,
          elevenlabs: model,
        }),
        // The real encoder in place of the stand-in: what it writes is what the game plays.
        encode: ffmpegEncoder,
      },
    )

    const takes = '/api/music/tracks/victory/takes'
    const clip = join(root, 'audio/music/victory.mp3')

    const view = async () => (await (await page.get(takes)).json()) as MusicTakesView

    /** Sends a change to the take, as its card does, and expects it to be taken. */
    async function press(method: string, path: string, body: unknown) {
      const response = await page.send(method, `/api/music/tracks/victory${path}`, body)
      expect([response.status, await response.json()]).toEqual([200, { ok: true }])
    }

    /** The samples a person hears when the page plays the take at `address`. */
    async function heard(address: string): Promise<Int16Array> {
      const response = await page.get(`${takes}/${address}`)
      expect(response.status).toBe(200)
      const { data } = readWav(new Uint8Array(await response.arrayBuffer()))
      return new Int16Array(new Uint8Array(data).buffer)
    }

    /**
     * Checks the fades in a trimmed take's sound: a straight fade in of 0.5 s and out of 0.8 s,
     * as loudness against the middle of the take.
     */
    function expectFades(samples: Int16Array) {
      const full = loudness(samples, 1)
      const length = samples.length / RATE
      expect(loudness(samples, 0.25) / full).toBeCloseTo(0.5, 1)
      expect(loudness(samples, length - 0.4) / full).toBeCloseTo(0.5, 1)
      expect(loudness(samples, length - 0.1) / full).toBeCloseTo(0.125, 1)
    }

    /**
     * The one take's file, and the length it has once its silent ends are cut. The tests below are
     * one person's steps in order, each going on from the one before.
     */
    let take = { file: '', seconds: 0 }

    it('cuts the silence off both ends of a take', async () => {
      const asked = await page.send('POST', takes, { count: 1, model: 'balanced' })
      expect(asked.status).toBe(200)
      let made = await view()
      for (const giveUp = Date.now() + 10_000; made.making.length > 0; made = await view()) {
        if (Date.now() > giveUp) throw new Error('the take never came')
        await Bun.sleep(10)
      }
      expect(made.failed).toEqual([])
      expect(made.takes).toMatchObject([{ trimmable: 'cut' }])
      const { file } = made.takes[0]!

      await press('POST', '/trim', { file })

      const [trimmed] = (await view()).takes
      // Two seconds of sound, and a moment of lead-in kept at each cut.
      expect(trimmed!.trim!.seconds).toBeCloseTo(2.1, 1)
      // The second of silence goes from the start, but for that moment.
      expect(trimmed!.trim!.start).toBeCloseTo(0.95, 2)
      take = { file, seconds: trimmed!.trim!.seconds }

      const sound = await heard(`${file}?trimmed=1`)
      expect(sound.length / RATE).toBeCloseTo(take.seconds, 2)
      expect(loudness(sound, 0.25) / loudness(sound, 1)).toBeCloseTo(1, 1)
    })

    it('fades the trimmed take in and out, as the person hears before saving', async () => {
      expectFades(await heard(`${take.file}?trimmed=1&fadeIn=0.5&fadeOut=0.8&shape=straight`))

      await press('PUT', `/takes/${take.file}/fades`, { in: 0.5, out: 0.8, shape: 'straight' })

      expect((await view()).takes).toMatchObject([
        { fades: { in: 0.5, out: 0.8, shape: 'straight' } },
      ])
      // Neither has reached the game: the take is not chosen yet.
      expect(existsSync(clip)).toBe(false)
    })

    it('gives the game the take as trimmed and faded', async () => {
      await press('POST', '/choose', { file: take.file })

      const game = decoded(clip)
      expect(game.length / RATE).toBeCloseTo(take.seconds, 1)
      expectFades(game)
      const manifest = JSON.parse(
        readFileSync(join(root, 'audio/music/manifest.json'), 'utf8'),
      ) as { victory: { duration: number } }
      expect(manifest.victory.duration).toBeCloseTo(take.seconds, 2)
    })
  },
)
