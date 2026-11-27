// RUN-2: a problem in the project file or in a file it points to is reported with the file and the
// place in it, instead of the studio failing.
import { afterAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../helpers'

const CLI = join(import.meta.dir, '../../bin/content-studio.ts')

const children: { kill(): void }[] = []
afterAll(() => children.forEach((child) => child.kill()))

/**
 * Runs `content-studio` in a temporary game holding `files`, with the providers and models faked
 * or left without a key. Once the studio has printed its address, gives a function that makes the
 * page's request at a path.
 */
async function startedOn(files: Record<string, unknown>) {
  const child = Bun.spawn([process.execPath, CLI, '--no-open'], {
    cwd: tempRepo(files),
    env: {
      ...process.env,
      CONTENT_STUDIO_FAKE_IMAGES: '1',
      CONTENT_STUDIO_FAKE_MUSIC: '1',
      CONTENT_STUDIO_FAKE_EFFECTS: '1',
      FISH_AUDIO_API_KEY: '',
      ELEVENLABS_API_KEY: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  children.push(child)
  // A studio that never says where it is gets stopped, so the failure shows what it did say.
  const giveUp = setTimeout(() => child.kill(), 15_000)
  const reader = child.stdout.getReader()
  let seen = ''
  let url: string | undefined
  while (!url) {
    const { value, done } = await reader.read()
    if (done) {
      const errors = await new Response(child.stderr).text()
      throw new Error(`the studio stopped without an address:\n${seen}${errors}`)
    }
    seen += new TextDecoder().decode(value)
    url = seen.match(/^Open (\S+)/m)?.[1]
  }
  clearTimeout(giveUp)
  return async (path: string) => {
    const response = await fetch(new URL(path, url))
    return { status: response.status, body: await response.json() }
  }
}

describe('RUN-2: a problem in the game’s files is reported with the file and the place', () => {
  it('starts on a project file with a problem and says where it is', async () => {
    const page = await startedOn({
      'content-studio.json': projectJson({
        parts: [{ id: 'act1', title: 'Act I' }, { id: 'act2' }],
      }),
    })

    const { status, body } = await page('/api/project')

    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: false })
    expect(body.problems).toEqual([
      { file: 'content-studio.json', path: 'parts[1].title', message: expect.any(String) },
    ])
  })

  it('says where a file it points to has a problem, and goes on with the rest', async () => {
    const page = await startedOn({
      'content-studio.json': projectJson(),
      'tts/act1/script.json': [
        { id: 'a', speaker: 'narrator', text: 'Once.' },
        { id: 'b', text: 'Twice.' },
      ],
      'tts/act2/script.json': [{ id: 'c', speaker: 'narrator', text: 'Thrice.' }],
    })
    const problem = {
      file: 'tts/act1/script.json',
      path: '[1].speaker',
      message: expect.any(String),
    }

    const project = await page('/api/project')
    const broken = await page('/api/parts/act1')
    const sound = await page('/api/parts/act2')

    expect(project.body).toMatchObject({ ok: true })
    expect(project.body.summary.problems).toEqual([problem])
    expect(broken.body.part.problems).toEqual([problem])
    expect(sound.body.part).toMatchObject({ problems: [], lines: [{ key: 'c' }] })
  })
})
