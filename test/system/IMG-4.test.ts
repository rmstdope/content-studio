// IMG-4: named areas: the person places a box (and a point, where it has one) for each area the
// game names on the picture, and they are saved for the game with the image.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AreaBox } from '../../src/core/images'
import type { ImageTakesView } from '../../src/core/imageTakes'
import type { ProjectSummary } from '../../src/core/summary'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** The box the person places for the door, with its point away from the box's centre. */
const DOOR: AreaBox = { x: 32, y: 50, width: 64, height: 100, point: { x: 48, y: 75 } }

/** The box they place for the window, whose point they leave alone. */
const WINDOW: AreaBox = { x: 160, y: 20, width: 80, height: 40 }

describe('IMG-4: the named areas are placed on a picture and saved for the game with it', () => {
  setDefaultTimeout(30_000)

  const { root, page } = startStudio({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/images.json': [
      {
        id: 'inn',
        title: 'Inn',
        text: 'A low inn',
        width: 320,
        height: 200,
        areas: [
          { id: 'door', title: 'The door' },
          { id: 'window', title: 'The window' },
        ],
      },
    ],
  })

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
    JSON.parse(readFileSync(join(root, 'web/images/manifest.json'), 'utf8')) as unknown

  /** The image's entry in the manifest as choosing its take leaves it. */
  const ENTRY = { file: 'inn.png', width: 320, height: 200 }

  /** The image as the Images pages show it. */
  async function row() {
    const response = await page.get('/api/project')
    const { summary } = (await response.json()) as { summary: ProjectSummary }
    return summary.images!.acts[0]!.rows[0]!
  }

  /** A change the page asks for, which must be taken. */
  async function send(method: string, path: string, body?: unknown) {
    const answer = await page.send(method, path, body)
    expect(answer.status).toBe(200)
  }

  it('asks for every area the game names on the picture chosen for the game', async () => {
    await send('POST', '/api/images/inn/takes', { count: 1 })
    for (const giveUp = Date.now() + 20_000; ;) {
      const view = (await (await page.get('/api/images/inn/takes')).json()) as ImageTakesView
      if (view.takes[0]?.look === 'ready') break
      if (Date.now() > giveUp) throw new Error('the take never came')
      await Bun.sleep(10)
    }
    await send('POST', '/api/images/inn/choose', { n: 1 })

    const image = await row()
    expect(image.areas.map((area) => [area.id, area.title, area.placed, area.box])).toEqual([
      ['door', 'The door', false, null],
      ['window', 'The window', false, null],
    ])
    expect(image.status).toBe('incomplete')
    expect(manifest()).toEqual({ inn: ENTRY })
  })

  it('saves each box, and its point where it has one, for the game with the image', async () => {
    await send('PUT', '/api/images/inn/areas/door', { box: DOOR })
    // The game has each box as soon as it is placed.
    const door = { x: 0.1, y: 0.25, width: 0.2, height: 0.5, mark: { x: 0.15, y: 0.375 } }
    expect(manifest()).toEqual({ inn: { ...ENTRY, areas: { door } } })

    await send('PUT', '/api/images/inn/areas/window', { box: WINDOW })
    // As fractions of the picture, and no mark for the box that has no point.
    expect(manifest()).toStrictEqual({
      inn: {
        ...ENTRY,
        areas: { door, window: { x: 0.5, y: 0.1, width: 0.25, height: 0.2 } },
      },
    })
  })

  it('shows the person every area placed where they put it, with nothing left to do', async () => {
    const image = await row()
    expect(image.areas.map((area) => [area.id, area.placed, area.box])).toEqual([
      ['door', true, DOOR],
      ['window', true, WINDOW],
    ])
    expect(image.status).toBe('chosen')
  })

  it('changes only the image’s picture and manifest and the studio’s own files', () => {
    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()

    expect(changed).toEqual([
      'content-studio/images/edits.json',
      'content-studio/images/lock.json',
      'web/images/inn.png',
      'web/images/manifest.json',
    ])
  })
})
