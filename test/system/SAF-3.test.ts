/**
 * SAF-3: No clip is deleted unless the person confirms it first.
 *
 * A clip is a file in one of the game's clips folders. The studio's server sees a confirmation as an
 * agent's call marked `confirmed` (the page asks in its own dialog, which its component tests
 * hold), so the agent is the one refused here.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** The limit of the test, which waits on jobs and takes, as `bun run test` sets it. */
const SLOW = 20_000

/** What the test looks at in a job or a list of takes. */
interface View {
  status?: string
  making?: unknown[]
  takes?: { file: string; n: number }[]
  patches?: { takes: unknown[] }[]
}

const track = (id: string) => ({ id, title: id, text: 'warm lute', seconds: 5 })

const { root, page, agent } = startStudio({
  'content-studio.json': projectJson({
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
  }),
  'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  'content-studio/images/edits.json': {
    style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
    images: {},
  },
  'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
  // A clip whose line has left the script.
  'audio/act1/manifest.json': { gone: { file: 'gone.mp3' } },
  'audio/act1/gone.mp3': 'ID3-not-really-audio',
  'tts/act1/music.json': [track('hall'), track('cellar')],
  'tts/act1/images.json': [
    {
      id: 'inn',
      title: 'Inn',
      text: 'a low inn',
      width: 320,
      height: 200,
      patches: [{ id: 'lamp', title: 'Lamp', text: 'put out the lamp' }],
    },
  ],
  'tts/effects.json': [{ id: 'coins', text: 'Coins spill on stone', seconds: 1 }],
})

/** Every clip the game has, by its path, with its bytes. */
function clips(): Record<string, string> {
  const folders = ['audio/act1', 'audio/music', 'audio/effects', 'web/images']
  return Object.fromEntries(
    folders
      .flatMap((folder) =>
        (readdirSync(join(root, folder), { recursive: true }) as string[]).map(
          (name) => `${folder}/${name}`,
        ),
      )
      .filter((path) => !path.endsWith('manifest.json') && statSync(join(root, path)).isFile())
      .sort()
      .map((path) => [path, readFileSync(join(root, path), 'base64')]),
  )
}

/** Reads `path` as an agent until `ready` holds of what it answers. */
async function settled(path: string, ready: (view: View) => boolean): Promise<View> {
  for (const giveUp = Date.now() + 10_000; ;) {
    const view = JSON.parse((await agent.read(path)).content[0]!.text!) as View
    if (ready(view)) return view
    if (Date.now() > giveUp) throw new Error(`${path} never settled`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A step the agent takes that must be done. */
async function done(path: string, body?: unknown, confirmed?: boolean): Promise<string> {
  const answer = await agent.act('POST', path, body, confirmed)
  expect({ path, answer: answer.isError ? answer.content[0]!.text : 'done' }).toEqual({
    path,
    answer: 'done',
  })
  return answer.content[0]!.text!
}

/** Waits until the narration job whose start answered `started` is over. */
async function over(started: string): Promise<void> {
  const { id } = JSON.parse(started) as { id: string }
  await settled(`/api/jobs/${id}`, (job) => job.status !== 'running')
}

/** Makes one more take on the board at `path` and answers the newest. */
async function newTake(path: string): Promise<{ file: string; n: number }> {
  const before = (await settled(path, () => true)).takes?.length ?? 0
  await done(path, { count: 1 })
  const view = await settled(
    path,
    (view) => !view.making?.length && (view.takes?.length ?? 0) > before,
  )
  return view.takes!.reduce((newest, take) => (take.n > newest.n ? take : newest))
}

/** Chooses a new take of each piece of music and the sound effect for the game. */
async function chooseSounds(): Promise<void> {
  for (const board of ['music/tracks/hall', 'music/tracks/cellar', 'effects/coins']) {
    const { file } = await newTake(`/api/${board}/takes`)
    await done(`/api/${board}/choose`, { file })
  }
}

/** Every step of the studio that deletes a clip of the game, and the clip it deletes. */
const DELETIONS: { path: string; body?: unknown; clip: string }[] = [
  {
    path: '/api/parts/act1/jobs',
    body: { speaker: null, keys: [], orphans: ['gone'] },
    clip: 'audio/act1/gone.mp3',
  },
  { path: '/api/music/tracks/hall/unchoose', clip: 'audio/music/hall.mp3' },
  // The music of a track the game no longer lists.
  { path: '/api/music/tracks/cellar/remove', clip: 'audio/music/cellar.mp3' },
  { path: '/api/effects/coins/unchoose', clip: 'audio/effects/coins.mp3' },
  // The patch before the image under it.
  { path: '/api/images/inn/patches/lamp/unchoose', clip: 'web/images/inn.lamp.png' },
  { path: '/api/images/inn/unchoose', clip: 'web/images/inn.png' },
]

describe('SAF-3: no clip is deleted unless the person confirms it first', () => {
  it(
    'keeps every clip until a step that deletes it is confirmed',
    async () => {
      await agent.connect()
      // A clip in every clips folder, made with the studio's own steps.
      await chooseSounds()
      const image = await newTake('/api/images/inn/takes')
      await done('/api/images/inn/choose', { n: image.n }, true)
      const area = { x: 32, y: 20, width: 64, height: 40 }
      await done('/api/images/inn/patches/lamp/takes', { count: 1, area })
      await settled('/api/images/inn/patches', (view) => Boolean(view.patches![0]!.takes.length))
      await done('/api/images/inn/patches/lamp/choose', { n: 1 }, true)
      // The game stops listing one of the tracks.
      writeFileSync(join(root, 'tts/act1/music.json'), JSON.stringify([track('hall')]))

      // Work that confirms no deletion deletes nothing: recording from the page without agreeing
      // to remove the clip whose line is gone, and choosing other takes.
      const response = await page.send('POST', '/api/parts/act1/jobs', {
        speaker: null,
        keys: ['a'],
        orphans: [],
      })
      expect(response.status).toBeLessThan(300)
      await over(await response.text())
      const hall = await newTake('/api/music/tracks/hall/takes')
      await done('/api/music/tracks/hall/choose', { file: hall.file })
      const coins = await newTake('/api/effects/coins/takes')
      await done('/api/effects/coins/choose', { file: coins.file })
      const full = clips()
      // The line just recorded, and every clip a step below deletes.
      expect(Object.keys(full)).toEqual(
        ['audio/act1/a.mp3', ...DELETIONS.map((deletion) => deletion.clip)].sort(),
      )

      // An agent that has not asked the person is refused every deletion.
      for (const { path, body } of DELETIONS) {
        const answer = await agent.act('POST', path, body)
        expect({ path, refused: answer.content[0]!.text }).toEqual({
          path,
          refused: expect.stringContaining('confirmed: true'),
        })
        expect(answer.isError).toBe(true)
      }
      expect(clips()).toEqual(full)

      // Once the person has agreed, each step deletes its clip and no other: the refusals above
      // were for want of the confirmation alone.
      const left = { ...full }
      for (const { path, body, clip } of DELETIONS) {
        const answer = await done(path, body, true)
        // A record job removes its orphans as it runs; the other steps are done when answered.
        if (path.endsWith('/jobs')) await over(answer)
        delete left[clip]
        expect(clips()).toEqual(left)
      }
    },
    SLOW,
  )
})
