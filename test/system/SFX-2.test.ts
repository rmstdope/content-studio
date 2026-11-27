// SFX-2: a take can be trimmed and faded, and an effect's level set, before it goes to the game.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EffectTakesView } from '../../src/core/effectTakes'
import { ffmpegEncoder } from '../../src/services/audio'
import { createFakeEffects } from '../../src/services/effectsFake'
import { projectJson } from '../helpers'
import { decoded, RATE, tone } from './sound'
import { startStudio } from './studio'

/** How loud the 50 ms around `at` seconds are: the root mean square of the samples. */
function loudness(samples: Int16Array, at: number): number {
  const window = samples.subarray(Math.round((at - 0.025) * RATE), Math.round((at + 0.025) * RATE))
  return Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length)
}

describe.skipIf(Bun.which('ffmpeg') === null)(
  'SFX-2: a take is trimmed, faded and given a level before it goes to the game',
  () => {
    // ffmpeg encodes each chosen take for real.
    setDefaultTimeout(30_000)

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
        'tts/effects.json': [{ id: 'coins', text: 'Coins spill on stone', seconds: 3 }],
      },
      {
        effects: {
          ...createFakeEffects(0),
          // Silent for half a second, sounds for a second and a half, and is silent again.
          generate: async (request) => ({
            wav: tone(400, request.seconds, 2, 0.5),
            seed: request.seed,
          }),
        },
        // The real encoder in place of the stand-in: what it writes is what the game plays.
        encode: ffmpegEncoder,
      },
    )

    const takes = '/api/effects/coins/takes'
    const clip = join(root, 'audio/effects/coins.mp3')
    const manifestFile = join(root, 'audio/effects/manifest.json')
    const game = () => ({
      clip: readFileSync(clip).toString('base64'),
      manifest: readFileSync(manifestFile, 'utf8'),
    })
    const duration = () =>
      (JSON.parse(readFileSync(manifestFile, 'utf8')) as { coins: { duration: number } }).coins
        .duration

    const view = async () => (await (await page.get(takes)).json()) as EffectTakesView

    /** Sends a change to the effect, as its page does, and expects it to be taken. */
    async function press(method: string, path: string, body: unknown) {
      const response = await page.send(method, `/api/effects/coins${path}`, body)
      expect([response.status, await response.json()]).toEqual([200, { ok: true }])
    }

    /**
     * The plain take's loudness in the game, the take that is worked on, and the game's files while
     * the plain one is in it. The tests below are one person's steps in order.
     */
    let plain = 0
    let take = ''
    let before = { clip: '', manifest: '' }

    it('gives the game a take as it was made, when nothing is done to it', async () => {
      expect(existsSync(clip)).toBe(false)
      const asked = await page.send('POST', takes, { count: 2 })
      expect(asked.status).toBe(200)
      let made = await view()
      for (const giveUp = Date.now() + 10_000; made.making.length > 0; made = await view()) {
        if (Date.now() > giveUp) throw new Error('the takes never came')
        await Bun.sleep(10)
      }
      expect(made.failed).toEqual([])
      expect(made.takes).toMatchObject([{ trimmable: 'cut' }, { trimmable: 'cut' }])

      await press('POST', '/choose', { file: made.takes[0]!.file })

      expect(duration()).toBeCloseTo(3, 2)
      const sound = decoded(clip)
      expect(sound.length / RATE).toBeCloseTo(3, 1)
      plain = loudness(sound, 1.2)
      expect(plain).toBeGreaterThan(1000)
      take = made.takes[1]!.file
      before = game()
    })

    it('trims, fades and levels another take without touching the game', async () => {
      await press('POST', '/trim', { file: take })
      await press('PUT', `/takes/${take}/fades`, { in: 0.4, out: 0.5, shape: 'straight' })
      await press('PUT', `/takes/${take}/level`, { level: 1.5 })

      const [, worked] = (await view()).takes
      // A second and a half of sound, and a moment kept at each cut.
      expect(worked!.trim!.seconds).toBeCloseTo(1.52, 2)
      expect(worked).toMatchObject({
        fades: { in: 0.4, out: 0.5, shape: 'straight' },
        level: 1.5,
      })
      expect(game()).toEqual(before)
    })

    it('gives the game that take as trimmed, faded and at its level', async () => {
      await press('POST', '/choose', { file: take })

      expect(duration()).toBeCloseTo(1.52, 2)
      const sound = decoded(clip)
      const length = sound.length / RATE
      expect(length).toBeCloseTo(1.52, 1)
      const full = loudness(sound, 0.7)
      // Half as loud again as the same sound left as made.
      expect(full / plain).toBeCloseTo(1.5, 1)
      // A straight fade in over 0.4 s and out over 0.5 s, as loudness against the middle.
      expect(loudness(sound, 0.2) / full).toBeCloseTo(0.5, 1)
      expect(loudness(sound, length - 0.25) / full).toBeCloseTo(0.5, 1)
      expect(loudness(sound, length - 0.05) / full).toBeCloseTo(0.1, 1)
    })
  },
)
