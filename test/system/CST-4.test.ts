// CST-4: the person can switch on clean-up of a cast voice and set its level, hearing the
// difference first. Cleaning the lines already in the game asks first, and they can be put back.
//
// ffmpeg is the real one: it is no provider and no model, and what it does to the game's clips is
// what is proven here. The page asks in its own dialogs, which its component tests hold, so the
// studio's server sees a confirmation as an agent's call marked `confirmed`: the agent is the one
// refused here. A level tried and not set is heard in the browser alone, so it is not proven here.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { quietestStretch } from '../../src/core/cleanup'
import { readWav, writeWav } from '../../src/core/wav'
import { fish } from '../../src/server/test-support'
import { decodeClip, ffmpegEncoder } from '../../src/services/audio'
import { projectJson } from '../helpers'
import { jobEnded, startStudio } from './studio'

const RATE = 16_000

/**
 * Three seconds as a noisy recording sounds: a voice-like burst from 0.5 s to 1.5 s, higher for
 * each `take`, over a low rumble with a little noise, which is all there is in the pauses.
 */
function noisy(take: number) {
  const data = new Uint8Array(RATE * 3 * 2)
  const view = new DataView(data.buffer)
  let seed = 7
  for (let i = 0; i < RATE * 3; i++) {
    const t = i / RATE
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    let v = 0.02 * Math.sin(2 * Math.PI * 150 * t) + (seed / 0x7fffffff - 0.5) * 0.004
    if (t > 0.5 && t < 1.5) v += 0.3 * Math.sin(2 * Math.PI * (500 + take * 50) * t)
    view.setInt16(i * 2, Math.round(v * 32767), true)
  }
  return writeWav({ format: { channels: 1, sampleRate: RATE, bitsPerSample: 16 }, data })
}

/** A clip as ffmpeg decodes it. */
const decoded = async (file: string) => readWav((await decodeClip(file)).wav)

/** How loud the noise in a clip's pauses is: its quietest stretch, in dBFS. */
const pauses = async (file: string) => quietestStretch(await decoded(file), 0.4)!.db

/** How loud a whole clip is: its mean level, in dBFS. */
async function loudness(file: string) {
  const { data } = await decoded(file)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let sum = 0
  for (let at = 0; at < data.length; at += 2) sum += (view.getInt16(at, true) / 32768) ** 2
  return 10 * Math.log10(sum / (data.length / 2))
}

/** What the clean-up takes off the noise in a pause, at the very least, in dB. */
const CLEANED = 10

// One walk over one studio: each test goes on from what the ones before it made.
describe.skipIf(Bun.which('ffmpeg') === null)(
  'CST-4: a cast voice is cleaned and levelled, heard first, asked about and put back',
  () => {
    // ffmpeg encodes, decodes and measures several clips in each test.
    setDefaultTimeout(30_000)

    const lines = [
      { id: 'a', speaker: 'narrator', text: 'The door opened.' },
      { id: 'b', speaker: 'narrator', text: 'Night fell.' },
      { id: 'g', speaker: 'guide', text: 'Follow me.' },
    ]
    let takes = 0
    const { root, page, agent } = startStudio(
      {
        'content-studio.json': projectJson(),
        'content-studio/narration/cast.json': {
          speakers: { narrator: { voice: 'v1' }, guide: { voice: 'v2' } },
        },
        'tts/act1/script.json': lines,
      },
      {
        encode: ffmpegEncoder,
        fish: { ...fish, tts: async () => noisy(++takes) },
      },
    )

    const clip = (key: string) => join(root, `audio/act1/${key}.mp3`)
    const original = (key: string) =>
      join(root, `content-studio/narration/originals/act1/${key}.mp3`)
    /** Every file of the game's clips folder, the manifest too, with its bytes. */
    const game = (): Record<string, string> =>
      Object.fromEntries(
        readdirSync(join(root, 'audio/act1'))
          .sort()
          .map((name) => [name, readFileSync(join(root, 'audio/act1', name), 'base64')]),
      )
    const narrator = () =>
      JSON.parse(readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8')).speakers
        .narrator as { clean?: boolean; level?: number }

    /** Records what the part's plan shows as missing, as the page does. */
    async function record() {
      const shown = await page.get('/api/parts/act1/plan')
      const { plan } = (await shown.json()) as { plan: { keys: string[] } }
      const started = await page.send('POST', '/api/parts/act1/jobs', {
        speaker: null,
        keys: plan.keys,
        orphans: [],
      })
      expect(started.status).toBe(200)
      const { id } = (await started.json()) as { id: string }
      expect(await jobEnded(page, id)).toMatchObject({ status: 'done', failed: [] })
    }

    /** What the narrator's Voice panel is told of the lines in the game. */
    async function inGame() {
      const answer = await page.get('/api/characters/narrator/cleaned-lines')
      return (await answer.json()) as {
        total: number
        cleaned: number
        job: { status: string; failed: unknown[] } | null
        levelJob: { status: string; failed: unknown[] } | null
        levels: { file: string; level: number }[]
      }
    }

    /** Waits until the narrator's clean-up or level job is over, with no line failed. */
    async function over(which: 'job' | 'levelJob') {
      for (const giveUp = Date.now() + 20_000; ;) {
        const job = (await inGame())[which]!
        if (job.status !== 'running')
          return expect(job).toMatchObject({ status: 'done', failed: [] })
        if (Date.now() > giveUp) throw new Error('the job never ended')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }

    /** An agent that has not asked the person is refused `path`, and the game is left as it was. */
    async function refused(path: string, body?: unknown) {
      const before = game()
      const cast = narrator()
      const answer = await agent.act('POST', path, body)
      expect(answer.isError).toBe(true)
      expect(answer.content[0]!.text).toContain('confirmed: true')
      expect(game()).toEqual(before)
      expect(narrator()).toEqual(cast)
    }

    it('lets the person hear a line cleaned before anything changes', async () => {
      await record()
      const before = game()

      const made = await page.send('POST', '/api/cleaned', { part: 'act1', file: 'a.mp3' })
      const copy = (await made.json()) as { ok: boolean; name: string }
      expect(copy.ok).toBe(true)
      // The two sides the page plays: the line as the game has it, and the cleaned copy.
      const folder = mkdtempSync(join(tmpdir(), 'content-studio-heard-'))
      const heard = async (path: string, name: string) => {
        const file = join(folder, name)
        writeFileSync(file, await (await page.get(path)).bytes())
        return pauses(file)
      }
      const recorded = await heard('/api/parts/act1/clips/a.mp3', 'heard-recorded.mp3')
      const cleaned = await heard(`/api/cleaned/${copy.name}`, 'heard-cleaned.mp3')
      expect(cleaned).toBeLessThan(recorded - CLEANED)

      expect(game()).toEqual(before)
      expect(narrator().clean).toBeUndefined()
    })

    it('switches the clean-up on for the voice: its new lines are cleaned', async () => {
      const before = game()
      const saved = await page.send('PATCH', '/api/characters/narrator', { clean: true })
      expect(saved.status).toBe(200)
      expect(narrator().clean).toBe(true)
      // Switching it on touches no line already in the game.
      expect(game()).toEqual(before)
      expect(await inGame()).toMatchObject({ total: 2, cleaned: 0 })

      writeFileSync(
        join(root, 'tts/act1/script.json'),
        JSON.stringify([...lines, { id: 'c', speaker: 'narrator', text: 'An owl called.' }]),
      )
      await record()
      expect(await pauses(clip('c'))).toBeLessThan((await pauses(clip('a'))) - CLEANED)
      expect(await inGame()).toMatchObject({ total: 3, cleaned: 1 })
    })

    it('asks first, then cleans the lines in the game, and puts them back', async () => {
      await agent.connect()
      const before = game()
      await refused('/api/characters/narrator/cleaned-lines/clean')
      expect(existsSync(original('a'))).toBe(false)

      const started = await page.send('POST', '/api/characters/narrator/cleaned-lines/clean')
      expect(started.status).toBe(200)
      await over('job')
      const cleaned = game()
      for (const key of ['a', 'b']) {
        // The game's clip is quieter in its pauses, and what it was is kept, byte for byte.
        expect(await pauses(clip(key))).toBeLessThan((await pauses(original(key))) - CLEANED)
        expect(readFileSync(original(key), 'base64')).toBe(before[`${key}.mp3`]!)
      }
      // The other voice, and what the game reads of the lines, are untouched.
      expect(cleaned['g.mp3']).toBe(before['g.mp3']!)
      expect(cleaned['manifest.json']).toBe(before['manifest.json']!)
      expect(await inGame()).toMatchObject({ total: 3, cleaned: 3 })

      // Switching the clean-up off, then putting the lines back, which is asked about too.
      await refused('/api/characters/narrator/cleaned-lines/put-back')
      const off = await page.send('PATCH', '/api/characters/narrator', { clean: false })
      expect(off.status).toBe(200)
      expect(narrator().clean).toBeUndefined()
      const back = await page.send('POST', '/api/characters/narrator/cleaned-lines/put-back')
      expect(back.status).toBe(200)
      await over('job')
      const after = game()
      for (const name of ['a.mp3', 'b.mp3', 'g.mp3']) expect(after[name]).toBe(before[name]!)
      // The line recorded cleaned comes back as it was recorded: as noisy as the others.
      expect(after['c.mp3']).not.toBe(before['c.mp3'])
      expect(await pauses(clip('c'))).toBeGreaterThan((await pauses(clip('a'))) - 3)
      expect(await inGame()).toMatchObject({ total: 3, cleaned: 0 })
    })

    it('asks first, then sets the voice’s level on its lines in the game', async () => {
      const before = game()
      const was = { a: await loudness(clip('a')), c: await loudness(clip('c')) }
      await refused('/api/characters/narrator/level', { level: 50 })

      const set = await page.send('POST', '/api/characters/narrator/level', { level: 50 })
      expect(set.status).toBe(200)
      await over('levelJob')
      expect(narrator().level).toBe(50)
      // Half the level is 6 dB down.
      for (const key of ['a', 'c'] as const) {
        const dropped = was[key] - (await loudness(clip(key)))
        expect(dropped).toBeGreaterThan(5)
        expect(dropped).toBeLessThan(7)
      }
      expect(game()['g.mp3']).toBe(before['g.mp3']!)
      expect((await inGame()).levels.map((line) => line.level)).toEqual([50, 50, 50])
    })
  },
)
