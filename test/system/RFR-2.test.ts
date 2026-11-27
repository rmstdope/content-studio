// RFR-2: Refresh from the game on an act's Music, Images and Scenes pages, and on the Stingers and
// Sound effects pages, runs the game's own command to rewrite its lists; each page reports only its
// own list's changes. The studio runs nothing else of the game's.
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectSummary } from '../../src/core/summary'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const line = (id: string) => ({ id, speaker: 'narrator', text: `Line ${id}.` })
const track = (id: string) => ({ id, title: `The ${id}`, text: `A ${id} tune`, seconds: 5 })
const image = (id: string) => ({
  id,
  title: `The ${id}`,
  text: `A ${id}`,
  width: 32,
  height: 20,
})
const scene = (id: string) => ({ id, title: `The ${id}`, states: [], triggers: [] })
const effect = (id: string) => ({ id, text: `A ${id}`, seconds: 1 })

/** Every list the game writes, by the file it writes it to, as it stands at the start. */
const LISTS: Record<string, unknown[]> = {
  'tts/act1/script.json': [line('a')],
  'tts/act1/music.json': [track('hall')],
  'tts/act1/images.json': [image('inn')],
  'tts/act1/scenes.json': [scene('store')],
  'tts/act2/script.json': [line('z')],
  'tts/act2/music.json': [track('crypt')],
  'tts/act2/images.json': [image('tomb')],
  'tts/act2/scenes.json': [scene('vault')],
  'tts/stingers.json': [track('victory')],
  'tts/effects.json': [effect('coins')],
}

/** Where the test's game keeps what its commands write the list at `path` from. */
const sourceOf = (path: string) => path.replace(/^tts\//, 'game-src/')

/** The renderer's mark on the process, should anything but the browser ever run it. */
const RENDERER_RAN = 'rfr2RendererRan'

const { root, page } = startStudio({
  'content-studio.json': projectJson({
    music: {
      from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
      clips: 'audio/music',
      manifest: 'audio/music/manifest.json',
    },
    images: {
      from: { part: 'tts/{part}/images.json' },
      clips: 'web/images',
      manifest: 'web/images/manifest.json',
      motion: 'web/motion.js',
    },
    effects: {
      from: { shared: 'tts/effects.json' },
      clips: 'audio/effects',
      manifest: 'audio/effects/manifest.json',
    },
    scenes: { from: { part: 'tts/{part}/scenes.json' }, mix: 'web/{part}.mix.json' },
    refresh: { part: 'sh tools/part.sh {part}', shared: 'sh tools/shared.sh' },
  }),
  'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
  ...LISTS,
  ...Object.fromEntries(Object.entries(LISTS).map(([path, list]) => [sourceOf(path), list])),
  // The game's two commands, each noting in ran.log that it was run.
  'tools/part.sh': 'echo "part $1" >> ran.log\ncp game-src/"$1"/*.json tts/"$1"/\n',
  'tools/shared.sh': 'echo shared >> ran.log\ncp game-src/*.json tts/\n',
  // Other code of the game's the studio reads: its motion renderer, which only the browser runs.
  'web/motion.js': `globalThis.${RENDERER_RAN} = true\nexport const effectTypes = []\n`,
})

/** Every file of the game with its content, but for the studio's cache. */
function game(): Record<string, string> {
  const paths = (readdirSync(root, { recursive: true }) as string[]).sort()
  return Object.fromEntries(
    paths
      .filter((path) => !path.startsWith('content-studio/cache/'))
      .filter((path) => statSync(join(root, path)).isFile())
      .map((path) => [path, readFileSync(join(root, path), 'utf8')]),
  )
}

/** The commands of the game that have run, in order. */
const ran = () =>
  existsSync(join(root, 'ran.log'))
    ? readFileSync(join(root, 'ran.log'), 'utf8').trim().split('\n')
    : []

/** The list the game's file at `path` holds now. */
const written = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown

/** Changes what the game's commands will write to each of these lists. */
function gameNowHas(lists: Record<string, unknown[]>) {
  for (const [path, list] of Object.entries(lists)) {
    writeFileSync(join(root, sourceOf(path)), JSON.stringify(list))
  }
}

/** What the pages show, as they read it. */
async function summary() {
  const response = await page.get('/api/project')
  const body = (await response.json()) as { ok: boolean; summary: ProjectSummary }
  expect(body.ok).toBe(true)
  return body.summary
}

/** The ids each page lists. */
async function listed() {
  const { music, images, scenes, effects } = await summary()
  const tracks = (id: string) =>
    music!.lists.find((list) => list.id === id)!.tracks.map((t) => t.id)
  return {
    music: tracks('act1'),
    images: images!.acts.find((act) => act.id === 'act1')!.order,
    scenes: scenes!.acts.find((act) => act.id === 'act1')!.scenes.map((s) => s.id),
    stingers: tracks('stingers'),
    effects: effects!.rows.map((row) => row.id),
  }
}

/** Clicks Refresh from the game, whose request is at `path`, and gives what the page is told. */
async function refresh(path: string) {
  const response = await page.send('POST', path)
  const body = (await response.json()) as unknown
  expect([response.status, body]).toMatchObject([200, { ok: true }])
  return body
}

const before = game()

// The cases are one session of a person's, in order: the last sums up what all of them ran.
describe('RFR-2: Refresh from the game runs the game’s own command, and nothing else of it', () => {
  it('runs nothing of the game’s when the studio starts and its pages are read', async () => {
    expect(await listed()).toEqual({
      music: ['hall'],
      images: ['inn'],
      scenes: ['store'],
      stingers: ['victory'],
      effects: ['coins'],
    })
    const renderer = (await (await page.get('/api/images/motion')).json()) as unknown
    expect(renderer).toMatchObject({ named: true, ok: true })

    expect(ran()).toEqual([])
    expect(game()).toEqual(before)
  })

  // The three pages of an act make the same request.
  for (const [name, path, next, loops] of [
    [
      'Music',
      'tts/act1/music.json',
      [track('cellar')],
      {
        added: [{ id: 'cellar', title: 'The cellar' }],
        removed: [{ id: 'hall', title: 'The hall' }],
      },
    ],
    ['Images', 'tts/act1/images.json', [image('inn'), image('stable')], null],
    ['Scenes', 'tts/act1/scenes.json', [scene('store'), scene('yard')], null],
  ] as const) {
    it(`rewrites the act’s lists with the game’s command from its ${name} page`, async () => {
      gameNowHas({ [path]: [...next] })

      const told = await refresh('/api/parts/act1/refresh')

      expect(written(path)).toEqual([...next])
      const shown = await listed()
      expect(shown[name.toLowerCase() as 'music' | 'images' | 'scenes']).toEqual(
        next.map((entry) => entry.id),
      )
      // All the page is told of changes: the act's dialog and loops, and no other list's.
      expect(told).toEqual({
        ok: true,
        lines: 1,
        diff: { added: [], removed: [], changed: [] },
        loops: { added: [], removed: [], ...loops, total: 1 },
        output: '',
      })
    })
  }

  /** New contents for both lists of no act, so that each shared refresh rewrites two lists. */
  const shared = (stingers: string[], effects: string[]) => {
    const lists = {
      'tts/stingers.json': stingers.map(track),
      'tts/effects.json': effects.map(effect),
    }
    gameNowHas(lists)
    return lists
  }

  it('tells the Stingers page only the stingers’ changes, though the command writes both lists', async () => {
    const lists = shared(['victory', 'defeat'], ['coins', 'door'])

    const told = await refresh('/api/music/stingers/refresh')

    for (const [path, list] of Object.entries(lists)) expect(written(path)).toEqual(list)
    expect((await listed()).stingers).toEqual(['victory', 'defeat'])
    expect(told).toEqual({
      ok: true,
      stingers: 2,
      change: { added: [{ id: 'defeat', title: 'The defeat' }], removed: [] },
      output: '',
    })
  })

  it('tells the Sound effects page only the effects’ changes, though the command writes both lists', async () => {
    const lists = shared(['fanfare'], ['door', 'wind'])

    const told = await refresh('/api/effects/refresh')

    for (const [path, list] of Object.entries(lists)) expect(written(path)).toEqual(list)
    expect((await listed()).effects).toEqual(['door', 'wind'])
    expect(told).toEqual({
      ok: true,
      effects: 2,
      change: { added: ['wind'], removed: ['coins'] },
      output: '',
    })
  })

  it('ran nothing of the game’s but the command of each click, which wrote only its lists', () => {
    expect(ran()).toEqual(['part act1', 'part act1', 'part act1', 'shared', 'shared'])
    expect((globalThis as Record<string, unknown>)[RENDERER_RAN]).toBeUndefined()

    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      // What the test itself wrote: the game's own changes.
      .filter((path) => !path.startsWith('game-src/'))
      .sort()
    expect(changed).toEqual([
      'ran.log',
      'tts/act1/images.json',
      'tts/act1/music.json',
      'tts/act1/scenes.json',
      'tts/effects.json',
      'tts/stingers.json',
    ])
  })
})
