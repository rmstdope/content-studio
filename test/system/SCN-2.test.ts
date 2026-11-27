// SCN-2: each scene's loudness is measured against the project's target, and the page shows which
// scenes are off it or not measured since they changed.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SceneLock } from '../../src/core/sceneLoudness'
import { writeWav } from '../../src/core/wav'
import { createFakeEffects } from '../../src/services/effectsFake'
import { unregisterDom } from '../dom'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

const RATE = 48_000

/** A stereo 1 kHz tone at a tenth of full scale, which reads −20 LUFS played at 100%. */
function tone(seconds: number) {
  const samples = new Int16Array(seconds * RATE * 2)
  for (let frame = 0; frame < seconds * RATE; frame++) {
    const value = Math.round(3277 * Math.sin((2 * Math.PI * 1000 * frame) / RATE))
    samples.set([value, value], frame * 2)
  }
  const format = { channels: 2, sampleRate: RATE, bitsPerSample: 16 }
  return writeWav({ format, data: new Uint8Array(samples.buffer) })
}

/** A scene of the mix playing the tone round and round at `level`. */
const humming = (level: number) => ({
  effects: [{ id: 'hum', play: { mode: 'loop' as const }, level }],
})

const mixFile = 'game/scenes/act1.mix.json'
const lockFile = 'content-studio/scenes/act1.lock.json'

const { root, url, page } = startStudio(
  {
    'content-studio.json': projectJson({
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
      scenes: {
        from: { part: 'tts/{part}/scenes.json' },
        mix: 'game/scenes/{part}.mix.json',
        output: { lufs: -20, tolerance: 2 },
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/effects.json': [{ id: 'hum', text: 'A hum', seconds: 2 }],
    'tts/act1/scenes.json': ['Hall', 'Cellar', 'Tower'].map((title) => ({
      id: title.toLowerCase(),
      title,
      states: [],
      triggers: [],
    })),
    // About −20, −32 and −10 LUFS.
    [mixFile]: { scenes: { hall: humming(1), cellar: humming(0.25), tower: humming(3) } },
  },
  {
    effects: {
      ...createFakeEffects(0),
      generate: async (request) => ({ wav: tone(request.seconds), seed: request.seed }),
    },
  },
)

// The DOM is the studio's page: it comes after the server is up, and Bun's own requests and
// answers are put back, which the server in this process is built on.
const native = { fetch, Request, Response, Headers, AbortController, AbortSignal }
GlobalRegistrator.register({ url: url.href })
Object.assign(globalThis, native)
// The page's requests, as a browser sends them: to the studio, with its Origin.
globalThis.fetch = ((path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  headers.set('origin', url.origin)
  return native.fetch(new URL(path, url), { ...init, headers })
}) as typeof fetch

// React reads `window` when react-dom loads, so it is imported after.
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('../../src/ui/App')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Takes down the page that is open, if one is. */
let close = () => {}

/** The open page's reads and writes, to tell when it has caught up with the studio. */
let client: InstanceType<typeof QueryClient>

/** Whether the open page has no request of the studio's left to wait for. */
const settled = () => client.isFetching() === 0 && client.isMutating() === 0

afterAll(async () => {
  close()
  globalThis.fetch = native.fetch
  await unregisterDom()
})

/**
 * Lets the page draw until `done` holds twice with a turn between (an answer is read a moment
 * before the page has drawn it), or fails saying what it shows.
 */
async function until(done: () => boolean) {
  for (let held = 0, giveUp = Date.now() + 45_000; held < 2;) {
    held = done() ? held + 1 : 0
    if (held === 2) return
    if (Date.now() > giveUp) throw new Error(`never came: ${document.body.textContent}`)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
  }
}

const text = (selector: string) =>
  [...document.querySelectorAll(selector)].map((element) => element.textContent!)

/** The Loudness panel of the open scene. */
const PANEL = 'section[aria-label="Loudness"]'

/** Opens a scene's page afresh, as a person loading it does. */
async function open(scene: string) {
  close()
  const container = document.createElement('div')
  document.body.append(container)
  const view = createRoot(container)
  client = new QueryClient()
  close = () => {
    act(() => view.unmount())
    client.clear()
    container.remove()
    close = () => {}
  }
  window.location.hash = `#/scenes/parts/act1?scene=${scene}`
  await act(async () => {
    view.render(createElement(QueryClientProvider, { client }, createElement(App)))
  })
  await until(() => document.querySelector(PANEL) !== null && settled())
}

/** What the page says of the open scene's loudness. */
const loudness = () => ({
  heading: text(`${PANEL} h2`).join(),
  figures: text(`${PANEL} tbody td`).filter(Boolean),
  when: text(`${PANEL} .scene-loud-when`).join(),
})

/** What the scene list says of each scene. */
const list = () =>
  Object.fromEntries(
    [...document.querySelectorAll('nav[aria-label="Scenes"] a')].map((link) => [
      link.querySelector('.grow')!.textContent,
      link.querySelector('.scene-count')!.textContent,
    ]),
  )

const button = () => document.querySelector<HTMLButtonElement>(`${PANEL} button`)!

/** Presses Measure loudness on the open page and waits for the figures it comes to show. */
async function measure() {
  const before = lock()
  await act(async () => button().click())
  await until(
    () =>
      // Every scene's figures are kept anew, and the page has read them.
      ['hall', 'cellar', 'tower'].every(
        (id) =>
          lock()?.[id]?.saved && lock()![id]!.saved!.measuredAt !== before?.[id]?.saved?.measuredAt,
      ) &&
      button().textContent === 'Measure loudness' &&
      // The button comes back before the page has read the last scene's figures.
      settled() &&
      loudness().when.startsWith('Measured ') &&
      !loudness().heading.includes('changed since measured'),
  )
}

/** The figures as the game's folder keeps them; undefined before any measure. */
function lock(): SceneLock | undefined {
  try {
    return JSON.parse(readFileSync(join(root, lockFile), 'utf8'))
  } catch {
    return undefined
  }
}

/** The figure kept for a scene. */
const kept = (scene: string) => lock()![scene]!.saved!.states[0]!.lufs!

/** The figure as the page writes it. */
const shown = (scene: string) => `${kept(scene).toFixed(1).replace('-', '−')} LUFS`

/** Every file of the game with its content, to see what a step changed, added or removed. */
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

// One walk over one studio: each test goes on from what the ones before it made. The measuring is
// real ffmpeg's, which is no provider or model.
describe.skipIf(Bun.which('ffmpeg') === null)(
  'SCN-2: each scene is measured against the target, and the page shows which need looking at',
  () => {
    // ffmpeg mixes a minute of sound for each scene measured, slowly on a busy machine.
    setDefaultTimeout(60_000)

    it('shows a scene never measured as not measured', async () => {
      // The hum needs a take chosen to be heard, which the person makes on its page.
      const takes = '/api/effects/hum/takes'
      expect((await page.send('POST', takes, { count: 1 })).status).toBe(200)
      let file: string | undefined
      for (const giveUp = Date.now() + 10_000; !file;) {
        const board = (await (await page.get(takes)).json()) as {
          making: unknown[]
          takes: { file: string }[]
        }
        if (board.making.length === 0) file = board.takes[0]?.file
        if (Date.now() > giveUp) throw new Error('the take never came')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect((await page.send('POST', '/api/effects/hum/choose', { file })).status).toBe(200)

      for (const scene of ['hall', 'cellar', 'tower']) {
        await open(scene)
        expect(loudness()).toEqual({
          heading: 'Loudness target −20 LUFS ± 2 dB',
          figures: [],
          when: 'Not measured yet. Measure loudness measures every scene in Act I.',
        })
      }
    })

    it('measures every scene and shows which are off the target, and which way', async () => {
      await open('hall')
      const before = game()

      await measure()

      // The figures are kept in the studio's lock; the game's mix is as it was.
      expect(changed(before, game())).toEqual([lockFile])
      expect(kept('hall')).toBeCloseTo(-20, 0)
      expect(kept('cellar')).toBeCloseTo(-32, 0)
      expect(kept('tower')).toBeCloseTo(-10.5, 0)

      expect(list()).toEqual({ Hall: '1 effect', Cellar: 'too quiet', Tower: 'too loud' })
      for (const [scene, chip] of [
        ['hall', /^on target$/],
        ['cellar', /^(11\.9|12\.0|12\.1) dB too quiet$/],
        ['tower', /^9\.[456] dB too loud$/],
      ] as const) {
        await open(scene)
        expect(loudness().figures).toEqual(['The scene', shown(scene), expect.stringMatching(chip)])
        expect(loudness().heading).toBe('Loudness target −20 LUFS ± 2 dB')
      }
    })

    it('shows a scene changed since it was measured, and no other', async () => {
      close()
      const mix = JSON.parse(readFileSync(join(root, mixFile), 'utf8')).scenes
      const saved = await page.send('PUT', '/api/scenes/act1/hall', {
        scene: humming(3),
        was: mix.hall,
      })
      expect(saved.status).toBe(200)

      await open('hall')
      expect(loudness().heading).toBe('Loudness target −20 LUFS ± 2 dB · changed since measured')
      for (const scene of ['cellar', 'tower']) {
        await open(scene)
        expect(loudness().heading).toBe('Loudness target −20 LUFS ± 2 dB')
      }
    })

    it('judges the changed scene on its new sound when measured again', async () => {
      await open('hall')

      await measure()

      expect(kept('hall')).toBeCloseTo(-10.5, 0)
      expect(loudness().heading).toBe('Loudness target −20 LUFS ± 2 dB')
      expect(loudness().figures).toEqual([
        'The scene',
        shown('hall'),
        expect.stringMatching(/ dB too loud$/),
      ])
      expect(list()).toEqual({ Hall: 'too loud', Cellar: 'too quiet', Tower: 'too loud' })
    })
  },
)
