import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fitsTemplate } from '../../src/server/mcpReadable'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** What the test looks at in a job or a list of takes. */
interface View {
  status?: string
  making?: unknown[]
  takes?: { file: string; n: number }[]
}

/** One thing studio_pages says can be read. */
interface Told {
  page: string
  path: string
  kind: 'state' | 'file'
}

/**
 * The limit of the tests that wait on takes or on ffmpeg (which `studio_fetch` measures a sound
 * with), as `bun run test` sets it, so a plain `bun test` does not cut them off at 5 s.
 */
const SLOW = 20_000

/** The states the pages of this game show, `job` being the narration job run here. */
const states = (job: string) => [
  // Setup, with the changes and the spending.
  '/api/project',
  '/api/setup',
  '/api/models',
  '/api/changes',
  `/api/jobs/${job}`,
  '/api/spending',
  '/api/credit',
  '/api/elevenlabs/account',
  '/api/elevenlabs/voices/freeable',
  // Narration
  '/api/narration/progress',
  '/api/parts/act1',
  '/api/parts/act1/lines/a/heard',
  '/api/parts/act1/plan',
  '/api/parts/act1/jobs/latest',
  '/api/parts/act1/lines/a/takes',
  '/api/characters/narrator/cleaned-lines',
  '/api/characters/narrator/designs',
  '/api/characters/narrator/ruled-out',
  '/api/characters/narrator/voice',
  '/api/auditions/narrator',
  '/api/auditions/narrator/sitting',
  // Music and Stingers
  '/api/music/tracks/hall/takes',
  '/api/music/lists/act1/batch',
  '/api/music/model-state',
  '/api/music/making',
  // Images
  '/api/images/motion',
  '/api/images/making',
  '/api/images/take-times',
  '/api/images/model-state',
  '/api/images/bring-all',
  '/api/image-acts/act1',
  '/api/image-acts/act1/batch',
  '/api/images/inn/takes',
  '/api/images/inn/patches',
  '/api/images/inn/fine-tunes',
  // Sound effects
  '/api/effects/making',
  '/api/effects/models',
  '/api/effects/batch',
  '/api/effects/coins/takes',
  // Scenes
  '/api/scene-loudness',
]

// One walk over one studio: each test goes on from what the ones before it made.
describe('AGT-1: an agent over MCP reads what every page shows and does the studio’s steps', () => {
  const studio = startStudio({
    'content-studio.json': projectJson({
      // The final recording is on a paid model, so the studio has a spending check to make.
      narration: {
        from: { part: 'tts/{part}/script.json' },
        clips: 'audio/{part}',
        manifest: 'audio/{part}/manifest.json',
        models: { fish: { final: 's2.1-pro' } },
      },
      music: {
        from: { part: 'tts/{part}/music.json' },
        clips: 'audio/music',
        manifest: 'audio/music/manifest.json',
      },
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
      scenes: { from: { part: 'tts/{part}/scenes.json' }, mix: 'game/{part}.mix.json' },
    }),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
    // A clip whose line has left the script: what a record job may delete.
    'audio/act1/manifest.json': { gone: { file: 'gone.mp3' } },
    'audio/act1/gone.mp3': 'ID3-not-really-audio',
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/act1/images.json': [{ id: 'inn', title: 'Inn', text: 'a low inn', width: 32, height: 20 }],
    'tts/effects.json': [{ id: 'coins', text: 'Coins spill on stone', seconds: 1 }],
    'tts/act1/scenes.json': [{ id: 'store', title: 'Store', states: [], triggers: [] }],
  })
  const { root, page, agent } = studio
  const file = (path: string) => readFileSync(join(root, path), 'utf8')
  let jobId = ''
  /** A take list with its take made and nothing left in the making. */
  const made = (view: View) => !view.making?.length && Boolean(view.takes?.length)
  /** Reads `path` as an agent until `ready` holds of what it answers. */
  async function settled(path: string, ready: (view: View) => boolean): Promise<View> {
    for (const giveUp = Date.now() + 10_000; ;) {
      const view = JSON.parse((await agent.read(path)).content[0]!.text!) as View
      if (ready(view)) return view
      if (Date.now() > giveUp) throw new Error(`${path} never settled`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  /** What studio_pages tells the agent it may read. */
  async function pagesTold(): Promise<Told[]> {
    const { read } = JSON.parse((await agent.pages()).content[0]!.text!) as {
      read: Record<string, Omit<Told, 'page'>[]>
    }
    return Object.entries(read).flatMap(([page, entries]) =>
      entries.map((entry) => ({ ...entry, page })),
    )
  }
  const done = async (method: string, path: string, body?: unknown, confirmed?: boolean) => {
    const answer = await agent.act(method, path, body, confirmed)
    expect({ path, answer: answer.isError ? answer.content[0]!.text : 'done' }).toEqual({
      path,
      answer: 'done',
    })
    return answer.content[0]!.text!
  }

  it('connects', async () => {
    expect(await agent.connect()).toEqual(
      expect.arrayContaining(['studio_pages', 'studio_read', 'studio_fetch', 'studio_act']),
    )
  })

  it(
    'does a step of every page, with the game getting the result',
    async () => {
      // Setup
      await done('PATCH', '/api/take-fade', { seconds: 0.25 })
      expect(file('content-studio/cache/settings.json')).toContain('0.25')

      // Narration: record the one line.
      const recording = await done('POST', '/api/parts/act1/jobs', {
        speaker: null,
        keys: ['a'],
        orphans: [],
      })
      jobId = JSON.parse(recording).id
      await settled(`/api/jobs/${jobId}`, (job) => job.status !== 'running')
      expect(JSON.parse(file('audio/act1/manifest.json')).a).toBeDefined()

      // Music, images and sound effects: make a take and choose it for the game.
      await done('POST', '/api/music/tracks/hall/takes', { count: 1 })
      const music = await settled('/api/music/tracks/hall/takes', made)
      await done('POST', '/api/music/tracks/hall/choose', { file: music.takes![0]!.file })
      expect(file('audio/music/manifest.json')).toContain('hall')

      await done('POST', '/api/images/inn/takes', { count: 1 })
      const image = await settled('/api/images/inn/takes', made)
      await done('POST', '/api/images/inn/choose', { n: image.takes![0]!.n }, true)
      expect(file('web/images/manifest.json')).toContain('inn')

      await done('POST', '/api/effects/coins/takes', { count: 1 })
      const effect = await settled('/api/effects/coins/takes', made)
      await done('POST', '/api/effects/coins/choose', { file: effect.takes![0]!.file })
      expect(file('audio/effects/manifest.json')).toContain('coins')

      // Scenes: save the scene's mix.
      const scene = {
        music: { track: 'hall', level: 0.5 },
        effects: [{ id: 'coins', play: { mode: 'loop' }, level: 1 }],
      }
      await done('PUT', '/api/scenes/act1/store', { scene, was: null })
      expect(file('game/act1.mix.json')).toContain('0.5')
    },
    SLOW,
  )

  it('reads the state every page shows, as the page gets it', async () => {
    const told = await pagesTold()
    const shown = states(jobId)
    // Every state the agent is told of is read here, and no other.
    expect(
      shown.map((path) => told.find((entry) => fitsTemplate(entry.path, path))?.path).sort(),
    ).toEqual(
      told
        .filter((entry) => entry.kind === 'state')
        .map((entry) => entry.path)
        .sort(),
    )
    for (const path of shown) {
      const answer = await agent.read(path)
      const response = await page.get(path)
      // Both must get the state itself: two matching refusals would read nothing.
      expect({ path, status: response.status, failed: answer.isError }).toEqual({
        path,
        status: 200,
        failed: undefined,
      })
      expect({ path, state: JSON.parse(answer.content[0]!.text!) }).toEqual({
        path,
        state: await response.json(),
      })
    }
  })

  it(
    'fetches the pictures and sounds of every page that has them, as the page gets them',
    async () => {
      const shown = [
        '/api/parts/act1/clips/a.mp3',
        '/api/music/tracks/hall/current',
        '/api/images/inn/current',
        '/api/images/inn/fine-tunes/base',
        '/api/effects/coins/current',
        '/api/scenes/act1/store/mix',
      ]
      const told = await pagesTold()
      const pageNames = (entries: Told[]) => [...new Set(entries.map((entry) => entry.page))].sort()
      expect(
        pageNames(shown.flatMap((path) => told.find((e) => fitsTemplate(e.path, path)) ?? [])),
      ).toEqual(pageNames(told.filter((entry) => entry.kind === 'file')))
      for (const path of shown) {
        const answer = await agent.fetch(path)
        const media = answer.content.find((block) => block.data !== undefined)
        const bytes = Buffer.from(await (await page.get(path)).arrayBuffer())
        expect(bytes.byteLength).toBeGreaterThan(0)
        expect({ path, data: media?.data }).toEqual({ path, data: bytes.toString('base64') })
      }
    },
    SLOW,
  )

  it('refuses an agent what it refuses the page, in the same words', async () => {
    for (const [method, path, body, status, why] of [
      // A value the page cannot save.
      ['PATCH', '/api/take-fade', { seconds: -1 }, 400, 'seconds'],
      // A paid recording whose cost nobody has confirmed: the agent is answered by the step's
      // /cost route, before the step, which must say what the step itself says to the page.
      ['POST', '/api/parts/act1/lines/a/record', { stage: 'final' }, 409, '"ceiling"'],
    ] as const) {
      const response = await page.send(method, path, body)
      const refusal = await response.text()
      expect(response.status).toBe(status)
      expect(refusal).toContain(why)
      const answer = await agent.act(method, path, body)
      expect(answer.isError).toBe(true)
      expect(answer.content[0]!.text).toBe(`${status} ${refusal}`)
    }
  })

  it('deletes clips only on a call marked confirmed', async () => {
    for (const [path, body, clip] of [
      // A record job removing a clip whose line left the script.
      [
        '/api/parts/act1/jobs',
        { speaker: null, keys: [], orphans: ['gone'] },
        'audio/act1/gone.mp3',
      ],
      // Taking the chosen music out of the game.
      ['/api/music/tracks/hall/unchoose', undefined, 'audio/music/hall.mp3'],
    ] as const) {
      expect(existsSync(join(root, clip))).toBe(true)
      const asked = await agent.act('POST', path, body)
      expect(asked.isError).toBe(true)
      expect(asked.content[0]!.text).toContain('confirmed: true')
      expect(existsSync(join(root, clip))).toBe(true)
      await done('POST', path, body, true)
      for (const giveUp = Date.now() + 10_000; existsSync(join(root, clip));) {
        if (Date.now() > giveUp) throw new Error(`${clip} was never deleted`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
  })
})
