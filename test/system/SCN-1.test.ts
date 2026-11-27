// SCN-1: the person hears a scene's music, effects and narration together as the game plays them,
// and sets the level of each; the levels are saved in the act's mix, the one scenes file the studio
// writes. The studio plays no narration over a scene (§8.11), so none is proven here.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectSummary } from '../../src/core/summary'
import { readWav, writeWav } from '../../src/core/wav'
import { createFakeEffects } from '../../src/services/effectsFake'
import { createFakeMusic } from '../../src/services/musicFake'
import { ffmpegSceneRender } from '../../src/services/sceneAudio'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const RATE = 48_000

/**
 * A clip holding one sample value throughout, in the mix's own format, so what a mix holds says
 * which clips are in it and how loud each is: their values times their levels, summed.
 */
function steady(value: number, seconds: number) {
  const samples = new Int16Array(seconds * RATE * 2).fill(value)
  const format = { channels: 2, sampleRate: RATE, bitsPerSample: 16 }
  return writeWav({ format, data: new Uint8Array(samples.buffer) })
}

/** The sample value of each clip, told apart by the words the game asks for it with. */
const MUSIC = 1000
const WIND = 3000
const RAIN = 500

describe.skipIf(Bun.which('ffmpeg') === null)('SCN-1: a scene is heard and its levels set', () => {
  // ffmpeg renders a minute of sound each time the scene is heard.
  setDefaultTimeout(30_000)

  const mixFile = 'game/scenes/act1.mix.json'
  /** Another scene's levels, which saving the hall's must not touch. */
  const attic = { music: { track: null, level: 1 }, effects: [] }
  const { root, page, agent } = startStudio(
    {
      'content-studio.json': projectJson({
        music: {
          from: { part: 'tts/{part}/music.json' },
          clips: 'audio/music',
          manifest: 'audio/music/manifest.json',
        },
        effects: {
          from: { shared: 'tts/effects.json' },
          clips: 'audio/effects',
          manifest: 'audio/effects/manifest.json',
        },
        scenes: { from: { part: 'tts/{part}/scenes.json' }, mix: 'game/scenes/{part}.mix.json' },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/act1/music.json': [{ id: 'theme', title: 'Theme', text: 'A slow theme', seconds: 20 }],
      'tts/effects.json': [
        { id: 'wind', text: 'Wind', seconds: 2 },
        { id: 'rain', text: 'Rain', seconds: 2 },
      ],
      'tts/act1/scenes.json': [
        { id: 'hall', title: 'Hall', states: ['calm', 'storm'], triggers: [] },
        { id: 'attic', title: 'Attic', states: [], triggers: [] },
      ],
      [mixFile]: { scenes: { attic } },
    },
    {
      music: {
        ...createFakeMusic(0),
        generate: async (request) => ({
          wav: steady(MUSIC, request.seconds),
          seed: request.seed,
        }),
      },
      effects: {
        ...createFakeEffects(0),
        generate: async (request) => ({
          wav: steady(request.prompt.includes('Wind') ? WIND : RAIN, request.seconds),
          seed: request.seed,
        }),
      },
      // The real render in place of the silent one: ffmpeg is no provider or model, and without it
      // nothing shows what is heard.
      sceneRender: (parts, window) => ffmpegSceneRender(root)(parts, window),
    },
  )

  /** Makes a take for a track or an effect and chooses it, as the person does on its page. */
  async function choose(base: string) {
    expect((await page.send('POST', `${base}/takes`, { count: 1 })).status).toBe(200)
    for (const giveUp = Date.now() + 10_000; ;) {
      const board = (await (await page.get(`${base}/takes`)).json()) as {
        making: unknown[]
        takes: { file: string }[]
      }
      const take = board.takes[0]
      if (take && board.making.length === 0) {
        expect((await page.send('POST', `${base}/choose`, { file: take.file })).status).toBe(200)
        return
      }
      if (Date.now() > giveUp) throw new Error(`${base}: the take never came`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /** Every file of the game with its content, to see what a save changed, added or removed. */
  function game(): Record<string, string> {
    const paths = (readdirSync(root, { recursive: true }) as string[]).sort()
    return Object.fromEntries(
      paths
        .filter((path) => statSync(join(root, path)).isFile())
        .map((path) => [path, readFileSync(join(root, path)).toString('base64')]),
    )
  }
  /** The files that differ between two looks at the game. */
  const changed = (before: Record<string, string>, after: Record<string, string>) =>
    [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (path) => before[path] !== after[path],
    )
  const savedScenes = () => JSON.parse(readFileSync(join(root, mixFile), 'utf8')).scenes

  /** The hall as the Scenes page reads it. */
  async function hall() {
    const response = await page.get('/api/project')
    const { summary } = (await response.json()) as { summary: ProjectSummary }
    return summary.scenes!.acts[0]!.scenes.find((scene) => scene.id === 'hall')!
  }

  /** The hall's mix: every sound at its level, the rain in the storm only. */
  const mix = (music: number, wind: number, rain: number) => ({
    music: { track: 'theme', level: music },
    effects: [
      { id: 'wind', play: { mode: 'loop' as const }, level: wind },
      { id: 'rain', play: { mode: 'loop' as const }, state: 'storm', level: rain },
    ],
  })

  /**
   * Hears a minute of the saved hall in `state`, as the person's agent does, and answers the sample
   * heard early on and near the end: the same, when every sound goes round for the whole minute.
   */
  async function heard(state: 'calm' | 'storm'): Promise<number[]> {
    const answer = await agent.fetch(`/api/scenes/act1/hall/mix?state=${state}`)
    expect(answer.isError).toBeUndefined()
    const sound = answer.content.find((block) => block.type === 'audio')!
    const { format, data } = readWav(new Uint8Array(Buffer.from(sound.data!, 'base64')))
    expect(format).toEqual({ channels: 2, sampleRate: RATE, bitsPerSample: 16 })
    expect(data.length).toBe(60 * RATE * 4)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    // Ten seconds into the theme's first and third time round, past the blend at its seam.
    return [10, 50].map((second) => view.getInt16(second * RATE * 4, true))
  }

  /** What a sample holds, give or take ffmpeg's rounding. */
  const expectSample = (samples: number[], value: number) => {
    for (const sample of samples) expect(Math.abs(sample - value)).toBeLessThanOrEqual(3)
  }

  it('gives the page the scene’s music and effects as the game has them', async () => {
    await choose('/api/music/tracks/theme')
    await choose('/api/effects/wind')
    await choose('/api/effects/rain')

    // The Scenes page plays each sound from these addresses, mixing them itself.
    for (const [address, file] of [
      ['/api/music/tracks/theme/current', 'audio/music/theme.mp3'],
      ['/api/effects/wind/current', 'audio/effects/wind.mp3'],
      ['/api/effects/rain/current', 'audio/effects/rain.mp3'],
    ] as const) {
      const response = await page.get(address)
      expect([address, response.status]).toEqual([address, 200])
      expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync(join(root, file)))
    }
  })

  it('saves the level of each in the act’s mix, and writes no other file', async () => {
    const before = game()
    const scene = mix(0.5, 2, 1)

    const saved = await page.send('PUT', '/api/scenes/act1/hall', { scene, was: null })

    expect([saved.status, await saved.json()]).toEqual([200, { ok: true }])
    expect(savedScenes()).toEqual({ hall: scene, attic })
    expect(changed(before, game())).toEqual([mixFile])
    expect((await hall()).entry).toEqual(scene)
  })

  it('plays them together, each at its saved level, as the scene’s state has it', async () => {
    expectSample(await heard('calm'), MUSIC * 0.5 + WIND * 2)
    expectSample(await heard('storm'), MUSIC * 0.5 + WIND * 2 + RAIN * 1)
  })

  it('saves and plays the levels as they are changed next', async () => {
    const before = game()
    const scene = mix(3, 0.5, 2)

    const saved = await page.send('PUT', '/api/scenes/act1/hall', {
      scene,
      was: (await hall()).entry,
    })

    expect(saved.status).toBe(200)
    expect(savedScenes()).toEqual({ hall: scene, attic })
    expect(changed(before, game())).toEqual([mixFile])
    expectSample(await heard('storm'), MUSIC * 3 + WIND * 0.5 + RAIN * 2)
  })
})
