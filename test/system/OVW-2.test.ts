// OVW-2: the Changes page lists what git sees of the files the studio wrote, so the person knows
// what to commit.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChangeKind } from '../../src/core/changes'
import type { ImageTakesView } from '../../src/core/imageTakes'
import type { MusicTakesView } from '../../src/core/musicTake'
import type { ChangesResult } from '../../src/services/git'
import { fish } from '../../src/server/test-support'
import { projectJson } from '../helpers'
import { jobEnded, startStudio, wavOf } from './studio'

const line = (id: string, text: string) => ({ id, speaker: 'narrator', text })

describe('OVW-2: the Changes page lists what git sees of the files the studio wrote', () => {
  setDefaultTimeout(30_000)

  const warm = async () => (await fish.listVoices({ pageSize: 1, pageNumber: 1 })).items[0]!
  const files = {
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
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/script.json': [line('a1', 'The door opened.'), line('a2', 'Night fell.')],
    'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'Warm lute', seconds: 5 }],
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'A low inn', width: 320, height: 200 },
    ],
    'notes.txt': 'The game’s own notes.',
  }
  let takes = 0
  const { root, page } = startStudio(files, {
    // Each recording is a second longer than the one before, so git sees a new clip as changed.
    fish: { ...fish, getVoice: warm, tts: async () => wavOf(++takes) },
  })

  /** Runs git on the game, as the person does, untouched by a hook's environment. */
  function git(...args: string[]) {
    const env: Record<string, string | undefined> = { ...process.env }
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) {
      delete env[name]
    }
    const run = Bun.spawnSync(
      ['git', '-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args],
      { cwd: root, env },
    )
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  }
  const commit = () => {
    git('add', '--all')
    git('commit', '--quiet', '--no-verify', '--message', 'the person’s commit')
  }
  git('init', '--quiet')
  commit()

  /** What the Changes page is told. */
  async function changes() {
    const result = (await (await page.get('/api/changes')).json()) as ChangesResult
    if (!result.ok) throw new Error(JSON.stringify(result))
    return result.groups
  }

  /** A change the page asks for, which must be taken. */
  async function send(method: string, path: string, body?: unknown) {
    const answer = await page.send(method, path, body)
    expect([path, answer.status]).toEqual([path, 200])
    return answer
  }

  /** Waits for the one take asked for at `path`, as the take's page does. */
  async function takeAt<View>(path: string, ready: (view: View) => boolean) {
    for (const giveUp = Date.now() + 20_000; ;) {
      const view = (await (await page.get(path)).json()) as View
      if (ready(view)) return view
      if (Date.now() > giveUp) throw new Error(`${path}: the take never came`)
      await Bun.sleep(10)
    }
  }

  /** Records what the part's plan shows. */
  async function record() {
    const shown = await page.get('/api/parts/act1/plan?language=en')
    const { plan } = (await shown.json()) as { plan: { keys: string[]; orphans: string[] } }
    const started = await send('POST', '/api/parts/act1/jobs?language=en', {
      speaker: null,
      keys: plan.keys,
      orphans: plan.orphans,
    })
    const { id } = (await started.json()) as { id: string }
    expect(await jobEnded(page, id)).toMatchObject({ status: 'done', failed: [] })
  }

  const clips = (counts: Partial<Record<string, number>>) => ({
    new: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    conflict: 0,
    ...counts,
  })
  const file = <const Role>(path: string, change: ChangeKind, role: Role) => ({
    path,
    change,
    role,
  })

  it('has nothing to commit while the game is as the last commit left it', async () => {
    expect(await changes()).toEqual({
      total: 0,
      project: [],
      parts: [],
      music: null,
      images: null,
    })
  })

  it('lists what the studio wrote as the person worked, and no other file', async () => {
    await send('POST', '/api/auditions/narrator/start')
    await send('POST', '/api/auditions/narrator/add', { voice: 'w1' })
    await send('POST', '/api/auditions/narrator/move', { voice: 'w1', move: 'shortlist' })
    await send('POST', '/api/auditions/narrator/cast', { voice: 'w1' })
    await record()

    await send('PATCH', '/api/music/tracks/hall', { brief: 'A lone harp' })
    await send('POST', '/api/music/tracks/hall/takes', { count: 1 })
    const music = await takeAt<MusicTakesView>(
      '/api/music/tracks/hall/takes',
      (view) => view.making.length === 0 && view.takes.length === 1,
    )
    await send('POST', '/api/music/tracks/hall/choose', { file: music.takes[0]!.file })

    await send('PATCH', '/api/images/inn', { words: 'A snug inn' })
    await send('POST', '/api/images/inn/takes', { count: 1 })
    await takeAt<ImageTakesView>('/api/images/inn/takes', (view) => view.takes[0]?.look === 'ready')
    await send('POST', '/api/images/inn/choose', { n: 1 })

    // Changed by hand, and none of the studio's.
    writeFileSync(join(root, 'notes.txt'), 'Rewritten.')

    const listed = await changes()
    expect(listed.project).toEqual([
      { path: 'content-studio/narration/cast.json', change: 'modified' },
    ])
    expect(listed.parts).toEqual([
      {
        id: 'act1',
        title: 'Act I',
        files: [
          file('audio/act1/manifest.json', 'new', 'manifest'),
          file('content-studio/narration/act1.lock.json', 'new', 'lock'),
        ],
        clips: clips({ new: 2 }),
      },
    ])
    expect(listed.music).toEqual({
      files: [
        file('audio/music/manifest.json', 'new', 'manifest'),
        file('content-studio/music/edits.json', 'new', 'briefs'),
        file('content-studio/music/lock.json', 'new', 'lock'),
      ],
      clips: clips({ new: 1 }),
    })
    // Not the whole list: what else of the images the page should name is not pinned here.
    expect(listed.images?.files).toEqual(
      expect.arrayContaining([
        file('content-studio/images/edits.json', 'new', 'edits'),
        file('content-studio/images/lock.json', 'new', 'lock'),
        file('web/images/manifest.json', 'new', 'manifest'),
      ]),
    )
    expect(JSON.stringify(listed)).not.toContain('notes.txt')
  })

  it('lists nothing once committed, then what the studio changes and removes after that', async () => {
    commit()
    expect((await changes()).total).toBe(0)

    // The game drops a line from its script, and the person commits that.
    writeFileSync(
      join(root, 'tts/act1/script.json'),
      JSON.stringify([line('a1', 'The door opened.')]),
    )
    commit()
    await send('PATCH', '/api/parts/act1/cues/a1?language=en', { cue: '[hushed]' })
    await record()

    // Listed in git's order: the files it knew before the ones new to it.
    expect(await changes()).toEqual({
      total: 5,
      project: [],
      parts: [
        {
          id: 'act1',
          title: 'Act I',
          files: [
            file('audio/act1/manifest.json', 'modified', 'manifest'),
            file('content-studio/narration/act1.lock.json', 'modified', 'lock'),
            file('content-studio/narration/act1.edits.json', 'new', 'cues'),
          ],
          clips: clips({ modified: 1, deleted: 1 }),
        },
      ],
      music: null,
      images: null,
    })
  })
})
