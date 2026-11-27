// SAF-1: the studio writes only the files the project file names and its own files in
// content-studio/, never anything outside the project root, and never changes git.
import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const CLI = join(import.meta.dir, '../../bin/content-studio.ts')

/** The limit of the tests that start the command or wait on takes, as `bun run test` sets it. */
const SLOW = 20_000

const MUSIC = {
  from: { part: 'tts/{part}/music.json' },
  clips: 'audio/music',
  manifest: 'audio/music/manifest.json',
}

/** Where music's files would go beside the project root. */
const OUTSIDE = { clips: '../music', manifest: '../music/manifest.json' }

/** The game's project file, with every kind of content; `sections` replaces any of them. */
function gameProject(sections: Record<string, unknown> = {}) {
  return projectJson({
    parts: [{ id: 'act1', title: 'Act I' }],
    music: MUSIC,
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
    scenes: { from: { part: 'tts/{part}/scenes.json' }, mix: 'web/{part}.mix.json' },
    ...sections,
  })
}

/**
 * A repository that holds a game in its folder `game/` and other things beside it, so that
 * whatever is written outside the project root is seen.
 */
function repository(): Record<string, unknown> {
  const game = {
    'content-studio.json': gameProject(),
    'content-studio/narration/cast.json': { speakers: { narrator: { voice: 'v1' } } },
    'content-studio/images/edits.json': {
      style: { look: 'pixel art', keepOut: 'text', palette: ['#000000'] },
      images: {},
    },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
    // A clip whose line has left the script: what a recording removes.
    'audio/act1/manifest.json': { gone: { file: 'gone.mp3' } },
    'audio/act1/gone.mp3': 'ID3-not-really-audio',
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
    'tts/act1/images.json': [
      {
        id: 'inn',
        title: 'Inn',
        text: 'a low inn',
        width: 32,
        height: 20,
        areas: [{ id: 'door', title: 'Door' }],
      },
    ],
    'tts/effects.json': [{ id: 'coins', text: 'Coins spill on stone', seconds: 1 }],
    'tts/act1/scenes.json': [{ id: 'store', title: 'Store', states: [], triggers: [] }],
    // The game's own code and settings, which the studio has no business with.
    '.gitignore': 'build/\n',
    'src/main.ts': 'export {}\n',
  }
  return {
    ...Object.fromEntries(Object.entries(game).map(([path, file]) => [`game/${path}`, file])),
    'README.md': 'The repository around the game.\n',
    '.gitignore': 'node_modules/\n',
  }
}

/** Runs git in the temporary repository, away from any repository this test itself runs in. */
function git(root: string, ...args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  )
  const { exitCode, stderr } = Bun.spawnSync(
    [
      'git',
      ...['-c', 'user.name=Test', '-c', 'user.email=test@example.com'],
      ...['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'],
      ...args,
    ],
    { cwd: root, env },
  )
  if (exitCode !== 0) throw new Error(`git ${args[0]}: ${stderr.toString()}`)
}

/** Every file and folder under `root`, `.git` included, with a hash of each file's bytes. */
function snapshot(root: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const path of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const full = join(root, path)
    found.set(
      path,
      statSync(full).isDirectory()
        ? 'folder'
        : createHash('sha256').update(readFileSync(full)).digest('hex'),
    )
  }
  return found
}

/** The paths that were added, changed or removed between two snapshots, sorted. */
function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort()
}

/** What changed anywhere but inside the game's folder, git's own files included. */
const outsideTheGame = (paths: string[]) => paths.filter((path) => !path.startsWith('game/'))

/** Starts the real command on the project at `folder`, waits for its address and stops it. */
async function startedOnce(folder: string) {
  const child = Bun.spawn([process.execPath, CLI, '--no-open'], {
    cwd: folder,
    env: { ...process.env, FISH_AUDIO_API_KEY: '', ELEVENLABS_API_KEY: '' },
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const giveUp = setTimeout(() => child.kill(), 15_000)
  try {
    let seen = ''
    for await (const chunk of child.stdout) {
      seen += new TextDecoder().decode(chunk)
      if (/^Open \S+/m.test(seen)) return
    }
    throw new Error(`the studio stopped without an address:\n${seen}`)
  } finally {
    clearTimeout(giveUp)
    child.kill()
    await child.exited
  }
}

/** The repository committed to git, and the studio started on its game. */
function studioOnRepository() {
  const studio = startStudio(repository(), {}, 'game')
  git(studio.root, 'init', '--quiet')
  git(studio.root, 'add', '--all')
  git(studio.root, 'commit', '--quiet', '--message', 'The game')
  return studio
}

/** What the page's request answers, failing the test with the refusal when the step is not done. */
async function answered<T>(response: Promise<Response>): Promise<T> {
  const answer = await response
  const body = await answer.text()
  expect({ url: answer.url, status: answer.status, body: answer.ok ? '' : body }).toEqual({
    url: answer.url,
    status: 200,
    body: '',
  })
  return JSON.parse(body) as T
}

/** Reads `path` as the page does until `ready` holds of what it answers. */
async function settled<T>(
  read: (path: string) => Promise<Response>,
  path: string,
  ready: (view: T) => boolean,
): Promise<T> {
  for (const giveUp = Date.now() + 10_000; ;) {
    const view = await answered<T>(read(path))
    if (ready(view)) return view
    if (Date.now() > giveUp) throw new Error(`${path} never settled`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A take list with its take made and nothing left in the making. */
interface Takes {
  making?: unknown[]
  takes?: { file: string; n: number }[]
}
const made = (view: Takes) => !view.making?.length && Boolean(view.takes?.length)

describe('SAF-1: the studio writes only the named files and its own folder, and never git', () => {
  const walked = studioOnRepository()
  const refused = studioOnRepository()

  it(
    'changes nothing but those through a person’s work on every page',
    async () => {
      const { root, page } = walked
      const before = snapshot(root)
      const done = <T>(method: string, path: string, body?: unknown) =>
        answered<T>(page.send(method, path, body))
      const takes = (path: string) => settled<Takes>(page.get, path, made)

      await startedOnce(join(root, 'game'))

      // Setup: a model, saved in the project file.
      await done('PUT', '/api/image-model', { model: 'z-image-turbo', was: 'klein' })

      // Narration: a character's style and a line's cue, then a recording, which also removes the
      // clip whose line has left the script.
      await done('PATCH', '/api/characters/narrator', { style: '[warm]' })
      await done('PATCH', '/api/parts/act1/cues/a', { cue: '[low]' })
      const job = await done<{ id: string }>('POST', '/api/parts/act1/jobs', {
        speaker: null,
        keys: ['a'],
        orphans: ['gone'],
      })
      await settled<{ status: string }>(
        page.get,
        `/api/jobs/${job.id}`,
        (view) => view.status !== 'running',
      )

      // Music, images and sound effects: reword, make a take and choose it for the game.
      await done('PATCH', '/api/music/tracks/hall', { brief: 'a slow lute' })
      await done('POST', '/api/music/tracks/hall/takes', { count: 1 })
      const music = await takes('/api/music/tracks/hall/takes')
      await done('POST', '/api/music/tracks/hall/choose', { file: music.takes![0]!.file })

      await done('PATCH', '/api/image-style', { look: 'oil painting' })
      await done('POST', '/api/images/inn/takes', { count: 1 })
      const image = await takes('/api/images/inn/takes')
      await done('POST', '/api/images/inn/choose', { n: image.takes![0]!.n })
      await done('PUT', '/api/images/inn/areas/door', {
        box: { x: 2, y: 2, width: 8, height: 8 },
      })

      await done('PATCH', '/api/effects/coins', { description: 'Coins on oak' })
      await done('POST', '/api/effects/coins/takes', { count: 1 })
      const effect = await takes('/api/effects/coins/takes')
      await done('POST', '/api/effects/coins/choose', { file: effect.takes![0]!.file })

      // Scenes: a mix saved.
      await done('PUT', '/api/scenes/act1/store', {
        scene: {
          music: { track: 'hall', level: 0.5 },
          effects: [{ id: 'coins', play: { mode: 'once', afterSeconds: 1 }, level: 1 }],
        },
        was: null,
      })

      // The Changes page, the one place the studio runs git.
      expect(await done<{ ok: boolean }>('GET', '/api/changes')).toMatchObject({ ok: true })

      const paths = changed(before, snapshot(root))
      // Nothing beside the project root, and nothing of git's: the person commits.
      expect(outsideTheGame(paths)).toEqual([])
      const inGame = paths
        .map((path) => path.slice('game/'.length))
        .filter(
          (path) => statSync(join(root, 'game', path), { throwIfNoEntry: false })?.isFile() ?? true,
        )
      // Outside its own folder, exactly the files the project file names, and the project file.
      expect(inGame.filter((path) => !/^content-studio(\/|$)/.test(path))).toEqual([
        'audio/act1/a.mp3',
        'audio/act1/gone.mp3',
        'audio/act1/manifest.json',
        'audio/effects/coins.mp3',
        'audio/effects/manifest.json',
        'audio/music/hall.mp3',
        'audio/music/manifest.json',
        'content-studio.json',
        'web/act1.mix.json',
        'web/images/inn.png',
        'web/images/manifest.json',
      ])
      // And its own folder was written, so the walk did reach the studio's files too.
      expect(inGame).toEqual(
        expect.arrayContaining([
          'content-studio/.gitignore',
          'content-studio/narration/cast.json',
          'content-studio/images/lock.json',
          'content-studio/music/lock.json',
          'content-studio/effects/lock.json',
        ]),
      )
    },
    SLOW,
  )

  it(
    'writes nothing outside the project root, even where the project file names a place there',
    async () => {
      const { root, page } = refused
      await answered(page.send('POST', '/api/music/tracks/hall/takes', { count: 1 }))
      const { takes } = await settled<Takes>(page.get, '/api/music/tracks/hall/takes', made)
      // The game's project file now names places beside the project root.
      writeFileSync(
        join(root, 'game/content-studio.json'),
        JSON.stringify(gameProject({ music: { ...MUSIC, ...OUTSIDE } })),
      )
      const before = snapshot(root)

      // The refusal goes to the server's log, which is kept out of the test's output.
      const log = console.error
      console.error = () => {}
      const chosen = await page
        .send('POST', '/api/music/tracks/hall/choose', { file: takes![0]!.file })
        .finally(() => (console.error = log))

      expect(outsideTheGame(changed(before, snapshot(root)))).toEqual([])
      expect(chosen.ok).toBe(false)
    },
    SLOW,
  )
})
