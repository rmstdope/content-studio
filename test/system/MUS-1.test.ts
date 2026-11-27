// MUS-1: each loop and stinger the game lists can be made as takes, with a local model or Eleven
// Music, from a brief the person can edit. The person listens and chooses a take, and the chosen
// take is the track the game gets.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { MusicTakesView } from '../../src/core/musicTake'
import type { ProjectSummary } from '../../src/core/summary'
import { STINGER_GENERATED_SECONDS } from '../../src/core/musicModels'
import { readWav } from '../../src/core/wav'
import { ffmpegEncoder } from '../../src/services/audio'
import type { MusicPieceRequest } from '../../src/services/elevenlabs'
import { createElevenMusic } from '../../src/services/elevenMusic'
import { createMusicRouter, type MusicGenerator, type MusicRequest } from '../../src/services/music'
import { fakeEleven, projectJson } from '../helpers'
import { decoded, RATE, tone } from './sound'
import { startStudio } from './studio'

/**
 * The pitch of a second of mono samples, by how often they cross zero. It is the second from the
 * half second on, clear of the fade a stinger ends on and of what an MP3 has around its start.
 */
function pitchOf(samples: Int16Array): number {
  const second = samples.subarray(RATE / 2, (3 * RATE) / 2)
  let crossings = 0
  for (let i = 1; i < second.length; i++) if (second[i - 1]! < 0 !== second[i]! < 0) crossings++
  return crossings / 2 / (second.length / RATE)
}

describe.skipIf(Bun.which('ffmpeg') === null)('MUS-1: a track is made and chosen', () => {
  // ffmpeg decodes Eleven Music's takes and encodes each chosen one for real.
  setDefaultTimeout(30_000)

  /** The tracks the game lists, and the length each stinger or loop plays in these takes. */
  const loop = { id: 'hall', title: 'Hall', text: 'Warm lute by the fire', seconds: 5 }
  const stinger = { id: 'victory', title: 'Victory', text: 'Short brass fanfare', seconds: 5 }

  /** What each model was asked for, in turn. */
  const local: MusicRequest[] = []
  const eleven: MusicPieceRequest[] = []
  /** The pitch of the take just asked for: 100 Hz, then 100 Hz more for each by either model. */
  const nextPitch = () => 100 * (local.length + eleven.length)
  /**
   * A stinger's sound ends after two seconds, a loop's lasts as long as asked. Each take has a
   * pitch of its own, which levelling and encoding keep, so it tells which take is heard.
   */
  const soundOf = (seconds: number) => (seconds === STINGER_GENERATED_SECONDS ? 2 : seconds)

  const onThisComputer: MusicGenerator = {
    ready: () => ({ ok: true }),
    installed: () => true,
    async generate(request) {
      local.push(request)
      const pitch = nextPitch()
      return {
        wav: tone(pitch, request.seconds, soundOf(request.seconds)),
        seed: request.seed,
      }
    },
    close() {},
  }
  /**
   * The real Eleven Music generator, over a stand-in for the ElevenLabs account. It answers a WAV
   * where ElevenLabs answers an MP3: ffmpeg decodes either, and MP3 input is not proven here.
   */
  const elevenMusic = createElevenMusic({
    apiKey: async () => 'key',
    client: () => ({
      ...fakeEleven().client,
      async music(request) {
        eleven.push(request)
        const seconds = request.lengthMs / 1000
        return tone(nextPitch(), seconds, soundOf(seconds))
      },
    }),
  })

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
      'tts/act1/music.json': [loop],
      'tts/stingers.json': [stinger],
    },
    {
      music: createMusicRouter({
        acestep: onThisComputer,
        'stable-audio': onThisComputer,
        elevenlabs: elevenMusic,
      }),
      // The real encoder in place of the stand-in: ffmpeg is no provider or model, and what it
      // writes is what the game plays.
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
    JSON.parse(readFileSync(join(root, 'audio/music/manifest.json'), 'utf8')) as unknown

  /** The tracks as the Music and Stingers pages list them. */
  async function tracks() {
    const response = await page.get('/api/project')
    const { summary } = (await response.json()) as { summary: ProjectSummary }
    return summary.music!.lists.flatMap((list) => list.tracks)
  }

  const takesOf = async (id: string) =>
    (await (await page.get(`/api/music/tracks/${id}/takes`)).json()) as MusicTakesView

  /** Asks for a take of a track with `model` and waits for it, as its page does. */
  async function make(id: string, model: 'balanced' | 'eleven') {
    const had = (await takesOf(id)).takes.length
    const asked = await page.send('POST', `/api/music/tracks/${id}/takes`, { count: 1, model })
    expect([asked.status, await asked.json()]).toEqual([200, { ok: true }])
    for (const giveUp = Date.now() + 10_000; ;) {
      const view = await takesOf(id)
      if (view.making.length === 0) {
        expect(view.failed).toEqual([])
        expect(view.takes).toHaveLength(had + 1)
        return
      }
      if (Date.now() > giveUp) throw new Error(`${id}: the take never came`)
      await Bun.sleep(10)
    }
  }

  /** The pitch a person hears when playing a take on the track's page. */
  async function listen(id: string, file: string) {
    const response = await page.get(`/api/music/tracks/${id}/takes/${file}`)
    expect(response.status).toBe(200)
    const { data } = readWav(new Uint8Array(await response.arrayBuffer()))
    return pitchOf(new Int16Array(new Uint8Array(data).buffer))
  }

  it('makes takes of each listed track, locally and with Eleven Music, from the edited brief', async () => {
    expect((await tracks()).map((track) => track.id)).toEqual(['hall', 'victory'])

    for (const [id, brief] of [
      ['hall', 'A lone harp at night'],
      ['victory', 'Bells ringing out'],
    ] as const) {
      const edited = await page.send('PATCH', `/api/music/tracks/${id}`, { brief })
      expect(edited.status).toBe(200)
      await make(id, 'balanced')
      await make(id, 'eleven')
    }

    expect(local.map(({ model, kind, brief }) => [model, kind, brief])).toEqual([
      ['balanced', 'loop', 'A lone harp at night'],
      ['balanced', 'stinger', 'Bells ringing out'],
    ])
    expect(eleven.map(({ prompt }) => prompt)).toEqual([
      'A lone harp at night',
      'Bells ringing out',
    ])
  })

  it('gives the game the take the person listened to and chose', async () => {
    /** The pitches of each track's two takes: the local one's, then Eleven Music's. */
    const made = { hall: [100, 200], victory: [300, 400] } as const
    for (const id of ['hall', 'victory'] as const) {
      const { takes } = await takesOf(id)
      // One take and then the other: the game has whichever was chosen last.
      for (const [i, take] of takes.entries()) {
        const pitch = made[id][i]!
        expect(Math.abs((await listen(id, take.file)) - pitch)).toBeLessThan(5)

        const chosen = await page.send('POST', `/api/music/tracks/${id}/choose`, {
          file: take.file,
        })

        expect([chosen.status, await chosen.json()]).toEqual([200, { ok: true }])
        expect(manifest()).toMatchObject({ [id]: { file: `${id}.mp3`, duration: take.seconds } })
        const clip = decoded(join(root, `audio/music/${id}.mp3`))
        expect(clip.length / RATE).toBeCloseTo(take.seconds, 1)
        expect(Math.abs(pitchOf(clip) - pitch)).toBeLessThan(5)
        expect((await takesOf(id)).chosen).toEqual({ known: true, take: take.n })
        expect((await tracks()).find((track) => track.id === id)).toMatchObject({
          status: 'chosen',
        })
      }
    }
    expect(Object.keys(manifest() as object)).toEqual(['hall', 'victory'])
  })

  it('changes only the music’s clips and manifest and the studio’s own files', () => {
    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()

    expect(changed).toEqual([
      'audio/music/hall.mp3',
      'audio/music/manifest.json',
      'audio/music/victory.mp3',
      'content-studio/music/edits.json',
      'content-studio/music/lock.json',
    ])
  })
})
