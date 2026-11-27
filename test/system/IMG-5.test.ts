// IMG-5: Movement: the person puts effects and a slow zoom on a picture, with their settings and
// where each plays, and sees them move as the game shows them; each change is saved for the game at
// once.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedEffects, SavedZoom } from '../../src/core/images'
import type { ImageTakesView } from '../../src/core/imageTakes'
import type { MotionRendererAnswer } from '../../src/core/motion'
import type { ProjectSummary } from '../../src/core/summary'
import { loadMotionModule, type MotionScene } from '../../src/ui/motionModule'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/**
 * The game's own motion renderer, no more than the test needs: each effect is drawn as its name at
 * its light's mark (else its spot's first corner, else the top left), rising as fast as its speed.
 */
const RENDERER = `
import { EFFECT_TYPES } from './effects.js'
export { EFFECT_TYPES }
export function createMotionScene() {
  let size = { width: 0, height: 0 }
  let specs = []
  let time = 0
  return {
    resize(width, height) { size = { width, height } },
    setEffects(next) { specs = next },
    step(ms) { time += ms },
    draw(ctx) {
      for (const { kind, settings, spot, mark } of specs) {
        const [x, y] = mark ?? spot?.[0][0] ?? [0, 0]
        ctx.fillText(kind, x * size.width, y * size.height - (settings.speed * time) / 100)
      }
    },
    isEmpty: () => specs.length === 0,
  }
}
`

const SPEED = { id: 'speed', title: 'Speed', min: 0, max: 3, step: 0.5, default: 1 }

/** The effects the game's renderer has. */
const EFFECTS = [
  { type: 'smoke', title: 'Smoke', spot: true, settings: [SPEED] },
  { type: 'glints', title: 'Glints', spot: false, placement: 'whole', settings: [SPEED] },
]

/** Where the person draws the smoke: a shape, as fractions of the picture. */
const CHIMNEY: [number, number][] = [
  [0.25, 0.5],
  [0.75, 0.5],
  [0.5, 0.75],
]

/** The shape they move it to. */
const HEARTH: [number, number][] = [
  [0.125, 0.25],
  [0.375, 0.25],
  [0.25, 0.5],
]

const SMOKE: SavedEffects[string] = {
  title: 'Smoke',
  on: true,
  settings: { speed: 2 },
  spot: [CHIMNEY],
}
const GLINTS: SavedEffects[string] = { title: 'Glints', on: true, settings: { speed: 0.5 } }
/** The smoke tuned, moved, and given a mark where its light comes from. */
const MOVED: SavedEffects[string] = {
  ...SMOKE,
  settings: { speed: 3 },
  spot: [HEARTH],
  mark: [0.25, 0.75],
}

describe('IMG-5: effects and a slow zoom are put on a picture, seen moving and saved at once', () => {
  setDefaultTimeout(30_000)

  const { root, page } = startStudio({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
        motion: 'web/motion/renderer.js',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/images.json': [
      { id: 'inn', title: 'Inn', text: 'A low inn', width: 320, height: 200 },
    ],
    'web/motion/renderer.js': RENDERER,
    'web/motion/effects.js': `export const EFFECT_TYPES = ${JSON.stringify(EFFECTS)}\n`,
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

  /** The image's entry in the manifest, as the game reads it now. */
  const entry = () =>
    (
      JSON.parse(readFileSync(join(root, 'web/images/manifest.json'), 'utf8')) as {
        inn: Record<string, unknown>
      }
    ).inn

  /** The image's entry as choosing its take leaves it. */
  const ENTRY = { file: 'inn.png', width: 320, height: 200 }

  /** The image as its page is given it. */
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

  /** The Movement tab saves the image's whole set of effects. */
  const saveEffects = (effects: SavedEffects) => send('PUT', '/api/images/inn/effects', { effects })

  /** The Movement tab saves the image's slow zoom; null is its Reset. */
  const saveZoom = (zoom: SavedZoom | null) => send('PUT', '/api/images/inn/zoom', { zoom })

  /** The game's renderer as the Movement tab gets and loads it. */
  async function renderer() {
    const response = await page.get('/api/images/motion')
    const answer = (await response.json()) as MotionRendererAnswer
    if (!answer.named || !answer.ok) throw new Error(`no renderer: ${JSON.stringify(answer)}`)
    const module = await loadMotionModule(answer.code)
    if ('error' in module) throw new Error(module.error)
    return module
  }

  /** What `scene` draws now: each effect's name and place. */
  function frame(scene: MotionScene) {
    const drawn: [string, number, number][] = []
    scene.draw({
      fillText: (text: string, x: number, y: number) => drawn.push([text, x, y]),
    } as unknown as CanvasRenderingContext2D)
    return drawn
  }

  it('shows the picture chosen for the game, with the game’s effects to put on it', async () => {
    await send('POST', '/api/images/inn/takes', { count: 1 })
    for (const giveUp = Date.now() + 20_000; ;) {
      const view = (await (await page.get('/api/images/inn/takes')).json()) as ImageTakesView
      if (view.takes[0]?.look === 'ready') break
      if (Date.now() > giveUp) throw new Error('the take never came')
      await Bun.sleep(10)
    }
    await send('POST', '/api/images/inn/choose', { n: 1 })

    const picture = await page.get('/api/images/inn/takes/1')
    expect(picture.headers.get('content-type')).toBe('image/png')
    expect((await renderer()).types).toEqual(EFFECTS as never)
    expect((await row()).effects).toEqual({})
    expect((await row()).zoom).toBeUndefined()
    expect(entry()).toEqual(ENTRY)
  })

  it('saves each effect for the game at once, with its settings and where it plays', async () => {
    await saveEffects({ smoke: SMOKE })
    const smoke = { kind: 'smoke', settings: { speed: 2 }, spot: [CHIMNEY] }
    expect(entry()).toStrictEqual({ ...ENTRY, effects: [smoke] })

    // A second effect, left where the game places it.
    await saveEffects({ smoke: SMOKE, glints: GLINTS })
    const glints = { kind: 'glints', settings: { speed: 0.5 } }
    expect(entry()).toStrictEqual({ ...ENTRY, effects: [glints, smoke] })

    await saveEffects({ smoke: MOVED, glints: GLINTS })
    expect(entry()).toStrictEqual({
      ...ENTRY,
      effects: [
        glints,
        { kind: 'smoke', settings: { speed: 3 }, spot: [HEARTH], mark: [0.25, 0.75] },
      ],
    })
  })

  it('moves them as the game shows them, by the game’s own renderer', async () => {
    // The renderer is given what the game is given. What the tab itself hands it to preview, and
    // the canvas it draws on, are the page's, which its component tests keep.
    const scene = (await renderer()).createScene()
    scene.resize(320, 200, { width: 320, height: 200 })
    scene.setEffects(entry().effects as Parameters<MotionScene['setEffects']>[0], true)

    // Each at its place: the glints at the top left, the smoke at its light's mark.
    expect(frame(scene)).toEqual([
      ['glints', 0, 0],
      ['smoke', 80, 150],
    ])
    scene.step(1000)
    // And each as fast as it was set.
    expect(frame(scene)).toEqual([
      ['glints', 0, -5],
      ['smoke', 80, 120],
    ])
  })

  it('saves each change of the slow zoom for the game at once', async () => {
    const effects = entry().effects

    await saveZoom({ on: true, seconds: 24, percent: 5 })
    expect(entry()).toStrictEqual({ ...ENTRY, effects, zoom: { seconds: 24, percent: 5 } })

    await saveZoom({ on: true, seconds: 40, percent: 7.5 })
    expect(entry().zoom).toEqual({ seconds: 40, percent: 7.5 })

    // Switched off, the game is told to hold the picture still.
    await saveZoom({ on: false, seconds: 40, percent: 7.5 })
    expect(entry()).toStrictEqual({ ...ENTRY, effects, zoom: null })

    // Reset gives the picture back to the game's own zoom.
    await saveZoom(null)
    expect(entry()).toStrictEqual({ ...ENTRY, effects })
  })

  it('takes out of the game what the person switches off, and shows what is saved', async () => {
    const zoom = { on: true, seconds: 8, percent: 2 }
    await saveZoom(zoom)
    const off = { smoke: { ...MOVED, on: false }, glints: GLINTS }
    await saveEffects(off)

    expect(entry().effects).toEqual([{ kind: 'glints', settings: { speed: 0.5 } }])
    // Coming back to the page, they find it all as they left it, the effect that is off too.
    const image = await row()
    expect(image.effects).toEqual(off)
    expect(image.zoom).toEqual(zoom)

    await saveEffects({})
    expect(entry()).toStrictEqual({ ...ENTRY, zoom: { seconds: 8, percent: 2 } })
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
