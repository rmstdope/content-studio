import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageRow } from '../../../core/images'
import type { MotionRendererAnswer } from '../../../core/motion'
import { valuesInEveryWindow } from '../../../../test/stylesheet'
// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register({ url: 'http://localhost/' })
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { MovementPanel } = await import('./MovementPanel')
const { JobOpenProvider } = await import('./ImageJobTabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
const realFetch = globalThis.fetch
afterEach(() => {
  cleanups.splice(0).forEach((c) => c())
  globalThis.fetch = realFetch
})
afterAll(() => GlobalRegistrator.unregister())

/** What the fake renderer's scene was asked, by the studio. */
interface Calls {
  made: number
  sources: unknown[]
  setEffects: {
    kind: string
    settings?: Record<string, number>
    spot?: [number, number][][]
    mark?: [number, number]
  }[][]
  steps: number
  stepMs: number[]
  draws: number
  resizes: { width: number; height: number }[]
}
const calls = (): Calls => (globalThis as unknown as { __motion: Calls }).__motion

/** A renderer as a game would write it: effect types and a scene that tells what it is asked. */
const RENDERER = (effects: string) => `
const note = () => globalThis.__motion
export const EFFECT_TYPES = ${effects}
export const createMotionScene = () => {
  note().made++
  return {
    setSource: (source) => note().sources.push(source),
    resize: (width, height, picture) => note().resizes.push(picture),
    setEffects: (specs) => note().setEffects.push(specs),
    step: (ms) => { note().steps++; note().stepMs.push(ms) },
    draw: () => note().draws++,
    isEmpty: () => true,
  }
}`
const setting = (id: string, title: string) =>
  `{ id: '${id}', title: '${title}', min: 0, max: 3, step: 0.05, default: 1 }`
const FOUR = `[
  { type: 'dust', title: 'Dust', spot: false, settings: [${setting('amount', 'Amount')}, ${setting('size', 'Size')}, ${setting('speed', 'Speed')}] },
  { type: 'mist', title: 'Mist', spot: false, settings: [${setting('amount', 'Amount')}] },
  { type: 'fire', title: 'Fire', spot: true, settings: [] },
  { type: 'water', title: 'Running water', spot: true, settings: [] },
]`

interface Options {
  answer?: MotionRendererAnswer | (() => MotionRendererAnswer | Promise<MotionRendererAnswer>)
  chosenTake?: number | null
  gameFile?: { file: string; exists: boolean } | null
  /** Patches of the image and which of them have a chosen take (by id). */
  patches?: { id: string; title: string; take: number | null }[]
  open?: boolean
  title?: string
  /** The effects the image has saved. */
  effects?: ImageRow['effects']
  /** The slow zoom the image has saved. */
  zoom?: ImageRow['zoom']
  /** What saving the zoom answers (default: ok). */
  zoomSaved?: () => Response | Promise<Response>
  /** What saving the effects answers (default: ok); a function can wait or fail. */
  saved?: () => Response | Promise<Response>
  onEffectsOn?: (count: number | null) => void
  /** The images lock cannot be read (the page's one answer). */
  lockUnread?: boolean
}

/** Renders the Movement panel of an image as the page gives it; gives what it asked of the server. */
async function render(options: Options = {}) {
  ;(globalThis as unknown as { __motion: Calls }).__motion = {
    made: 0,
    sources: [],
    setEffects: [],
    steps: 0,
    stepMs: [],
    draws: 0,
    resizes: [],
  }
  const asked: string[] = []
  const puts: { effects: ImageRow['effects'] }[] = []
  const zoomPuts: { zoom: ImageRow['zoom'] | null }[] = []
  // The canvas is 640 x 400 on screen; happy-dom has no layout.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    get: () => 640,
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    get: () => 400,
    configurable: true,
  })
  const answer = options.answer ?? { named: true as const, ok: true as const, code: RENDERER(FOUR) }
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push(url)
    if (url === '/api/images/inn/effects') {
      puts.push(JSON.parse(String(init?.body)))
      return options.saved ? options.saved() : Response.json({ ok: true })
    }
    if (url === '/api/images/inn/zoom') {
      zoomPuts.push(JSON.parse(String(init?.body)))
      return options.zoomSaved ? options.zoomSaved() : Response.json({ ok: true })
    }
    if (url === '/api/images/motion') {
      return Response.json(typeof answer === 'function' ? await answer() : answer)
    }
    return Response.json({
      ok: true,
      patches: (options.patches ?? []).map((p) => ({
        id: p.id,
        takes: p.take === null ? [] : [{ n: p.take, chosen: true }],
        making: [],
      })),
      remake: { press: null },
    })
  }) as typeof fetch
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let open = options.open ?? true
  const goneToMake: number[] = []
  const draw = async () => {
    const row = {
      id: 'inn',
      title: options.title ?? 'The Inn',
      width: 320,
      height: 200,
      chosenTake: options.chosenTake === undefined ? 3 : options.chosenTake,
      gameFile: options.gameFile ?? null,
      patches: (options.patches ?? []).map((p) => ({ id: p.id, title: p.title })),
      effects: options.effects ?? {},
      zoom: options.zoom,
    } as ImageRow
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            JobOpenProvider,
            { value: open },
            createElement(MovementPanel, {
              row,
              lockUnread: options.lockUnread ?? false,
              onGoToMake: () => goneToMake.push(1),
              onEffectsOn: options.onEffectsOn,
            }),
          ),
        ),
      )
    })
  }
  await draw()
  await settle()
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  const setOpen = async (now: boolean) => {
    open = now
    await draw()
    await settle()
  }
  return { host, asked, puts, zoomPuts, goneToMake, setOpen }
}

/** Lets pending requests, state updates and animation frames run. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 20)))
}

const text = (host: HTMLElement) => host.textContent ?? ''
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)
const switchFor = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('.movement-side .movement-switch')]
    .find((s) => s.textContent === label)
    ?.querySelector<HTMLInputElement>('input')
async function click(target: Element | null | undefined) {
  await act(async () => (target as HTMLElement).click())
  await settle()
}
async function press(key: string, target: Element = document.body) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
  await settle()
}

describe('the Movement panel', () => {
  it('says the project names no renderer, with nothing else, when it names none', async () => {
    const { host } = await render({ answer: { named: false } })
    expect(host.querySelector('h2')!.textContent).toBe('Movement')
    expect(host.querySelector('p')!.textContent).toBe(
      "This project names no motion renderer, so the studio can't show its images moving. The game names one in its project file.",
    )
    expect(host.querySelector('img')).toBeNull()
    expect(button(host, '⛶ Full screen')).toBeUndefined()
  })

  it('headed Movement, drawn by the project’s renderer, with the chosen take captioned', async () => {
    const { host } = await render()
    expect(host.querySelector('h2')!.textContent).toBe('Movement')
    expect(text(host)).toContain("drawn by the project's renderer")
    expect(host.querySelector<HTMLImageElement>('.movement-pic')!.getAttribute('src')).toBe(
      '/api/images/inn/takes/3',
    )
    expect(host.querySelector('.movement-caption')!.textContent).toBe(
      'Take 3, as the game will show it. Space pauses · F for full screen.',
    )
    expect(button(host, '❚❚ Pause')).toBeDefined()
    expect(button(host, '⛶ Full screen')).toBeDefined()
  })

  it('lists every effect the renderer reports, in its order, with name, range and start of each setting', async () => {
    const { host } = await render()
    expect(text(host)).toContain('Switch an effect on to put it in the game. None are on.')
    const rows = [...host.querySelectorAll('.movement-side .movement-effect')]
    expect(rows.map((r) => r.querySelector('.movement-switch')!.textContent)).toEqual([
      'Dust',
      'Mist',
      'Fire',
      'Running water',
    ])
    expect(rows[0]!.querySelector('.movement-settings')!.textContent).toBe(
      'Amount 0–3 (1) · Size 0–3 (1) · Speed 0–3 (1)',
    )
  })

  it('starts every effect off, and runs one switched on at its starting settings', async () => {
    const { host } = await render()
    expect(calls().made).toBe(1)
    expect(calls().resizes[0]).toEqual({ width: 320, height: 200 })
    expect(calls().setEffects.at(-1)).toEqual([])
    await click(switchFor(host, 'Dust'))
    expect(calls().setEffects.at(-1)).toEqual([
      { kind: 'dust', settings: { amount: 1, size: 1, speed: 1 } },
    ])
    await click(switchFor(host, 'Dust'))
    expect(calls().setEffects.at(-1)).toEqual([])
  })

  it('says so while the renderer loads, over the dimmed still picture, with no buttons', async () => {
    const { host } = await render({ answer: () => new Promise<MotionRendererAnswer>(() => {}) })
    expect(text(host)).toContain('Loading the motion renderer…')
    expect(text(host)).toContain('Loading…')
    expect(host.querySelector('.movement-dim .movement-pic')).not.toBeNull()
    expect(button(host, '❚❚ Pause')).toBeUndefined()
    expect(button(host, '⛶ Full screen')).toBeUndefined()
  })

  it('shows the renderer’s own error with Try again, which loads it afresh', async () => {
    let answers: MotionRendererAnswer[] = [
      {
        named: true,
        ok: false,
        file: 'web/r.js',
        message: 'web/r.js: SyntaxError: Unexpected token (line 41)',
      },
      { named: true, ok: true, code: RENDERER(FOUR) },
    ]
    const { host } = await render({ answer: () => answers.shift()! })
    expect(text(host)).toContain('The motion renderer could not be loaded.')
    expect(host.querySelector('code')!.textContent).toBe(
      'web/r.js: SyntaxError: Unexpected token (line 41)',
    )
    expect(host.querySelector('.movement-caption')!.textContent).toBe(
      'The still picture shows underneath. Fix the renderer in the game, then press Try again.',
    )
    expect(text(host)).toContain('None: the renderer did not load.')
    expect(button(host, '⛶ Full screen')).toBeUndefined()
    answers = answers.slice(0)
    await click(button(host, 'Try again'))
    expect(button(host, '⛶ Full screen')).toBeDefined()
    expect(text(host)).not.toContain('could not be loaded')
  })

  it('reports a renderer that loads but has no usable EFFECT_TYPES as its error', async () => {
    const { host } = await render({
      answer: { named: true, ok: true, code: 'export const createMotionScene = () => ({})' },
    })
    expect(host.querySelector('code')!.textContent).toBe('the module does not export EFFECT_TYPES')
  })

  it('moves the picture with the slow zoom and patches when the renderer has no effects', async () => {
    const { host } = await render({ answer: { named: true, ok: true, code: RENDERER('[]') } })
    expect(text(host)).toContain(
      "The project's renderer has no effects yet. The slow zoom and the patches still move.",
    )
    expect(button(host, '⛶ Full screen')).toBeDefined()
    expect(host.querySelector('.movement-zoom')).not.toBeNull()
  })

  it('shows the game’s own picture, captioned, when no take is chosen', async () => {
    const { host } = await render({
      chosenTake: null,
      gameFile: { file: 'a.png', exists: true },
    })
    expect(host.querySelector<HTMLImageElement>('.movement-pic')!.getAttribute('src')).toBe(
      '/api/images/inn/current',
    )
    expect(host.querySelector('.movement-caption')!.textContent).toBe(
      "The game's own image, as the game will show it.",
    )
  })

  it('sits the stage in a dark frame, sized to the picture’s shape (320 / 200 here)', async () => {
    const { host } = await render()
    const wrap = host.querySelector<HTMLElement>('.movement-frame > .movement-wrap')!
    expect(wrap).not.toBeNull()
    expect(wrap.style.aspectRatio).toBe('320 / 200')
    expect(wrap.style.getPropertyValue('--ar')).toBe('1.6')
    expect(wrap.querySelector('.movement-pause')).not.toBeNull()
  })

  it('puts Pause and Full screen in one row on the stage, so a narrow stage wraps them instead of overlapping (as-l7wb)', async () => {
    const { host } = await render()
    const row = host.querySelector('.movement-wrap > .movement-buttons')!
    expect(row).not.toBeNull()
    expect(row.querySelector('.movement-pause')).not.toBeNull()
    expect(row.querySelector('.movement-full')).not.toBeNull()
  })

  it('gives the stage no shape to fit when there is no picture or the lock cannot be read: both stay as wide as the column', async () => {
    for (const options of [{ chosenTake: null }, { lockUnread: true, chosenTake: null }]) {
      const { host } = await render(options)
      const wrap = host.querySelector<HTMLElement>('.movement-frame > .movement-wrap')!
      expect(wrap.style.getPropertyValue('--ar')).toBe('')
    }
  })

  it('measures the room the window leaves, at least 240 px, and again when the window is resized', async () => {
    const was = window.innerHeight
    try {
      window.innerHeight = 800
      const { host } = await render()
      const column = host.querySelector<HTMLElement>('.movement-picture')!
      const room = () => column.style.getPropertyValue('--movement-room')
      expect(parseInt(room())).toBeGreaterThan(240)
      expect(parseInt(room())).toBeLessThanOrEqual(800)
      window.innerHeight = 100
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
      })
      expect(room()).toBe('240px')
    } finally {
      window.innerHeight = was
    }
  })

  it('when the stage starts too low on the page to fit, measures the room below the image’s tabs, as when scrolled to them (as-l7wb)', async () => {
    // 600x800: the sidebar is stacked above the page, so the tabs sit at 652 and the frame at 922.
    const was = window.innerHeight
    const rect = HTMLElement.prototype.getBoundingClientRect
    const tabs = document.createElement('div')
    tabs.setAttribute('role', 'tablist')
    tabs.className = 'job-tabs'
    document.body.append(tabs)
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const top = this === tabs ? 652 : this.classList.contains('movement-frame') ? 922 : 0
      return { ...rect.call(this), top, y: top }
    }
    try {
      window.innerHeight = 800
      const { host } = await render()
      const room = host
        .querySelector<HTMLElement>('.movement-picture')!
        .style.getPropertyValue('--movement-room')
      expect(parseInt(room)).toBeGreaterThan(400)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect
      window.innerHeight = was
      tabs.remove()
    }
  })

  it('has an empty stage with Go to Make when there is no picture at all, still listing the effects', async () => {
    const { host, goneToMake } = await render({ chosenTake: null })
    expect(text(host)).toContain('No take chosen yet')
    expect(text(host)).toContain('Choose a take on Make to see it move.')
    expect(text(host)).toContain('Switch an effect on to put it in the game. None are on.')
    expect(host.querySelector('.movement-pic')).toBeNull()
    await click(button(host, 'Go to Make'))
    expect(goneToMake.length).toBe(1)
  })

  it('lists the patches in the game’s order, off, with one that has no take dimmed and not switchable', async () => {
    const { host } = await render({
      patches: [
        { id: 'a', title: 'Lamp lit', take: 2 },
        { id: 'b', title: 'Door open', take: null },
      ],
    })
    const group = host.querySelector('.movement-side [aria-label="Patches"]')!
    expect([...group.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Lamp lit',
      'Door open · no take chosen',
    ])
    const boxes = group.querySelectorAll('input')
    expect(boxes.length).toBe(2)
    expect(boxes[0]!.checked).toBe(false)
    expect(boxes[1]!.getAttribute('aria-disabled')).toBe('true')
    expect(group.querySelectorAll('.movement-switch-off').length).toBe(1)
    await click(boxes[1])
    expect(host.querySelectorAll('.movement-pic').length).toBe(1)
    expect(host.querySelectorAll('.movement-pic').length).toBe(1)
    await click(switchFor(host, 'Lamp lit'))
    const laid = [...host.querySelectorAll<HTMLImageElement>('.movement-pic')].map((i) =>
      i.getAttribute('src'),
    )
    expect(laid).toEqual([
      '/api/images/inn/takes/3',
      '/api/images/inn/patches/a/patches/a/takes/2'.replace('/patches/a/patches/a', '/patches/a'),
    ])
  })

  it('leaves the Patches group out when the image has no patches', async () => {
    const { host } = await render()
    expect(host.querySelector('[aria-label="Patches"]')).toBeNull()
  })

  it('pauses and plays with the button and Space, and holds the zoom and the renderer', async () => {
    const { host } = await render()
    await settle()
    expect(calls().steps).toBeGreaterThan(0)
    await click(button(host, '❚❚ Pause'))
    expect(button(host, '▶ Play')).toBeDefined()
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-paused')).toBe('true')
    const held = calls().steps
    await settle()
    expect(calls().steps).toBe(held)
    await press(' ')
    expect(button(host, '❚❚ Pause')).toBeDefined()
    await settle()
    expect(calls().steps).toBeGreaterThan(held)
  })

  it('leaves Space and F alone while typing, and while another tab is open', async () => {
    const { host, setOpen } = await render()
    const field = document.createElement('textarea')
    document.body.append(field)
    await press(' ', field)
    expect(button(host, '❚❚ Pause')).toBeDefined()
    field.remove()
    await setOpen(false)
    await press(' ')
    await setOpen(true)
    expect(button(host, '❚❚ Pause')).toBeDefined()
  })

  it('puts every patch switch back off, and plays, when the tab is left; the effects stay', async () => {
    const { host, setOpen } = await render({
      patches: [{ id: 'a', title: 'Lamp lit', take: 2 }],
    })
    await click(switchFor(host, 'Dust'))
    await click(switchFor(host, 'Lamp lit'))
    await click(button(host, '❚❚ Pause'))
    await setOpen(false)
    await setOpen(true)
    expect(switchFor(host, 'Dust')!.checked).toBe(true)
    expect(switchFor(host, 'Lamp lit')!.checked).toBe(false)
    expect(button(host, '❚❚ Pause')).toBeDefined()
  })

  it('says the preview moves anyway when the computer asks for reduced motion', async () => {
    const real = globalThis.matchMedia
    globalThis.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof matchMedia
    cleanups.push(() => (globalThis.matchMedia = real))
    const { host } = await render()
    expect(host.querySelector('.movement-reduced')!.textContent).toBe(
      'This computer asks for reduced motion. The preview moves anyway; players who ask for it see the picture still.',
    )
    expect(calls().steps).toBeGreaterThan(0)
  })

  it('does not mention reduced motion otherwise', async () => {
    const { host } = await render()
    expect(host.querySelector('.movement-reduced')).toBeNull()
  })
})

/** Counts the asks for full screen on any element; nothing goes full screen. */
function spyFullscreen(): number[] {
  const asked: number[] = []
  ;(
    HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
  ).requestFullscreen = async () => void asked.push(1)
  cleanups.push(() => {
    delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
  })
  return asked
}

describe('what the stage does for the renderer', () => {
  it('gives the canvas a pixel buffer as big as it is on the screen, and tells the scene its size', async () => {
    const { host } = await render()
    const canvas = host.querySelector<HTMLCanvasElement>('canvas')!
    expect(canvas.width).toBe(640 * Math.min(2, globalThis.devicePixelRatio || 1))
    expect(canvas.height).toBe(400 * Math.min(2, globalThis.devicePixelRatio || 1))
  })

  it('hands the scene the loaded picture to redraw, when it asks for one', async () => {
    const { host } = await render()
    const image = host.querySelector<HTMLImageElement>('.movement-pic')!
    Object.defineProperty(image, 'complete', { value: true })
    Object.defineProperty(image, 'naturalWidth', { value: 320 })
    Object.defineProperty(image, 'naturalHeight', { value: 200 })
    await act(async () => image.dispatchEvent(new Event('load')))
    expect(calls().sources.at(-1)).toMatchObject({ width: 320, height: 200 })
  })

  it('paints a paused picture again when the canvas changes size, which clears it', async () => {
    let resized: () => void = () => {}
    const real = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        resized = callback
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    const realContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = (() => ({ setTransform() {} })) as never
    cleanups.push(() => {
      globalThis.ResizeObserver = real
      HTMLCanvasElement.prototype.getContext = realContext
    })
    const { host } = await render()
    await click(button(host, '❚❚ Pause'))
    const before = calls().draws
    // The canvas becomes another size, as it does when full screen opens.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => 1280,
      configurable: true,
    })
    await act(async () => resized())
    expect(calls().draws).toBeGreaterThan(before)
  })

  it('feeds the scene the picture again when the take changes', async () => {
    const { host } = await render()
    const image = host.querySelector<HTMLImageElement>('.movement-pic')!
    Object.defineProperty(image, 'complete', { value: true })
    Object.defineProperty(image, 'naturalWidth', { value: 320 })
    Object.defineProperty(image, 'naturalHeight', { value: 200 })
    await act(async () => image.dispatchEvent(new Event('load')))
    const once = calls().sources.length
    await act(async () => image.dispatchEvent(new Event('load')))
    expect(calls().sources.length).toBe(once + 1)
  })

  it('runs no frames while its tab is hidden, and none while paused', async () => {
    const { host, setOpen } = await render()
    await setOpen(false)
    const held = calls().steps
    await settle()
    expect(calls().steps).toBe(held)
    await setOpen(true)
    await settle()
    expect(calls().steps).toBeGreaterThan(held)
    await click(button(host, '❚❚ Pause'))
    const paused = calls().steps
    await settle()
    expect(calls().steps).toBe(paused)
  })
})

describe('the keys', () => {
  it('leave Space to a focused switch: it does not pause', async () => {
    const { host } = await render()
    const dust = switchFor(host, 'Dust')!
    await press(' ', dust)
    expect(button(host, '❚❚ Pause')).toBeDefined()
  })

  it('do nothing while the renderer loads, so the picture arrives playing', async () => {
    let release: (answer: MotionRendererAnswer) => void = () => {}
    const { host } = await render({
      answer: () => new Promise<MotionRendererAnswer>((resolve) => (release = resolve)),
    })
    const asked = spyFullscreen()
    await press(' ')
    await press('f')
    expect(asked.length).toBe(0)
    release({ named: true, ok: true, code: RENDERER(FOUR) })
    await settle()
    expect(button(host, '❚❚ Pause')).toBeDefined()
  })

  it('do nothing when there is no picture', async () => {
    await render({ chosenTake: null })
    const asked = spyFullscreen()
    await press('f')
    expect(asked.length).toBe(0)
  })
})

describe('a renderer that fails with no picture to show', () => {
  it('still says so and offers Try again', async () => {
    const { host } = await render({
      chosenTake: null,
      answer: { named: true, ok: false, file: 'web/r.js', message: 'web/r.js: boom' },
    })
    expect(text(host)).toContain('The motion renderer could not be loaded.')
    expect(button(host, 'Try again')).toBeDefined()
    expect(button(host, 'Go to Make')).toBeDefined()
    expect(text(host)).toContain('No take chosen yet')
  })
})

describe('the Movement panel in full screen', () => {
  /** Fakes the browser's Fullscreen API on the stage the panel asks to fill. */
  function fakeFullscreen() {
    let current: Element | null = null
    const doc = document as unknown as {
      fullscreenElement: Element | null
      exitFullscreen: () => Promise<void>
    }
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    doc.exitFullscreen = async () => {
      current = null
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
    return {
      leaveByEsc: async () => {
        current = null
        await act(async () => document.dispatchEvent(new Event('fullscreenchange')))
        await settle()
      },
    }
  }

  it('opens with the button or F, with a floating panel headed by the image’s title', async () => {
    fakeFullscreen()
    const { host } = await render({ title: 'The Inn' })
    await click(button(host, '⛶ Full screen'))
    const panel = host.querySelector('.movement-float')!
    expect(panel.querySelector('strong')!.textContent).toBe('The Inn')
    expect(
      [...panel.querySelectorAll('.movement-float-head button')].map((b) => b.textContent),
    ).toEqual(['❚❚', 'Hide', '✕ Close'])
    expect(panel.querySelector('[aria-label="Effects"]')).not.toBeNull()
    expect(button(host, '⛶ Full screen')).toBeUndefined()
  })

  it('opens with F', async () => {
    fakeFullscreen()
    const { host } = await render()
    await press('f')
    expect(host.querySelector('.movement-float')).not.toBeNull()
  })

  it('keeps the switches as they were set, in both directions', async () => {
    fakeFullscreen()
    const { host } = await render()
    await click(switchFor(host, 'Mist'))
    await click(button(host, '⛶ Full screen'))
    const inPanel = (label: string) =>
      [...host.querySelectorAll('.movement-float .movement-switch')]
        .find((s) => s.textContent === label)!
        .querySelector<HTMLInputElement>('input')!
    expect(inPanel('Mist').checked).toBe(true)
    await click(inPanel('Dust'))
    await click(host.querySelector<HTMLElement>('.movement-float-head button:last-child'))
    expect(switchFor(host, 'Dust')!.checked).toBe(true)
    expect(switchFor(host, 'Mist')!.checked).toBe(true)
  })

  it('pauses from the panel, shown as ▶, and folds to its heading with Hide and back with Show', async () => {
    fakeFullscreen()
    const { host } = await render()
    await click(button(host, '⛶ Full screen'))
    await click(button(host, '❚❚'))
    expect(button(host, '▶')).toBeDefined()
    await click(button(host, 'Hide'))
    expect(host.querySelector('.movement-float [aria-label="Effects"]')).toBeNull()
    expect(host.querySelector('.movement-float strong')).not.toBeNull()
    await click(button(host, 'Show'))
    expect(host.querySelector('.movement-float [aria-label="Effects"]')).not.toBeNull()
  })

  it('closes with ✕ Close or Esc and returns focus to the Full screen button', async () => {
    const browser = fakeFullscreen()
    const { host } = await render()
    await click(button(host, '⛶ Full screen'))
    await click(button(host, '✕ Close'))
    expect(host.querySelector('.movement-float')).toBeNull()
    expect(document.activeElement).toBe(button(host, '⛶ Full screen')!)
    ;(document.activeElement as HTMLElement).blur()
    await click(button(host, '⛶ Full screen'))
    await browser.leaveByEsc()
    expect(host.querySelector('.movement-float')).toBeNull()
    expect(document.activeElement).toBe(button(host, '⛶ Full screen')!)
  })
})

/** The slider of a setting in the side column (or the floating panel), by its name. */
const sliderFor = (host: HTMLElement, name: string, within = '.movement-side') =>
  [...host.querySelectorAll(`${within} .movement-slider`)]
    .find((s) => s.querySelector('label')!.textContent === name)
    ?.querySelector<HTMLInputElement>('input')
const valueOf = (host: HTMLElement, name: string, within = '.movement-side') =>
  [...host.querySelectorAll(`${within} .movement-slider`)]
    .find((s) => s.querySelector('label')!.textContent === name)
    ?.querySelector('output')?.textContent
/** Moves a slider as the page hears it: an input event, after a pointer press if `drag`. */
async function move(slider: HTMLInputElement, value: number, drag = false) {
  await act(async () => {
    if (drag) slider.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(slider, String(value))
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}
async function release(slider: HTMLInputElement) {
  await act(async () => slider.dispatchEvent(new Event('pointerup', { bubbles: true })))
  await settle()
}
const dust = (settings: Record<string, number>, on = true) => ({ on, settings })
/** What the page saves for Dust: with the title the renderer gave it. */
const saved = (settings: Record<string, number>, on = true) => ({
  title: 'Dust',
  on,
  settings,
})

describe('the effects of an image', () => {
  it('shows a slider for each setting of an effect that is on, at the renderer’s starting values, and saves the set', async () => {
    const { host, puts } = await render()
    await click(switchFor(host, 'Dust'))
    expect(
      host.querySelector('.movement-side .movement-effect:first-child .movement-settings'),
    ).toBeNull()
    expect(valueOf(host, 'Amount')).toBe('1.00')
    expect(sliderFor(host, 'Size')!.getAttribute('max')).toBe('3')
    expect(text(host)).toContain(
      "Switch an effect on to put it in the game. 1 of the renderer's 4 are on.",
    )
    expect(puts).toEqual([{ effects: { dust: saved({ amount: 1, size: 1, speed: 1 }) } }])
    expect(text(host)).toContain('Saved')
    expect(button(host, 'Reset')).toBeUndefined()
  })

  it('follows a slider live and saves once on letting go', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    const amount = sliderFor(host, 'Amount')!
    await move(amount, 1.25, true)
    expect(valueOf(host, 'Amount')).toBe('1.25')
    expect(calls().setEffects.at(-1)).toEqual([
      { kind: 'dust', settings: { amount: 1.25, size: 1, speed: 1 } },
    ])
    expect(puts).toEqual([])
    await move(amount, 1.5, true)
    await release(amount)
    expect(puts).toEqual([{ effects: { dust: saved({ amount: 1.5, size: 1, speed: 1 }) } }])
  })

  it('saves every step of a slider moved with the keyboard', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    const amount = sliderFor(host, 'Amount')!
    await move(amount, 1.05)
    await move(amount, 1.1)
    expect(puts.map((p) => p.effects.dust!.settings.amount)).toEqual([1.05, 1.1])
  })

  it('shows Reset only while a setting differs from its start, and puts them all back and saves', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 2, size: 1, speed: 0.5 }) },
    })
    expect(button(host, 'Reset')).toBeDefined()
    await click(button(host, 'Reset'))
    expect(valueOf(host, 'Amount')).toBe('1.00')
    expect(valueOf(host, 'Speed')).toBe('1.00')
    expect(button(host, 'Reset')).toBeUndefined()
    expect(puts).toEqual([{ effects: { dust: saved({ amount: 1, size: 1, speed: 1 }) } }])
  })

  it('puts focus on that effect’s own switch after Reset, so a keyboard user keeps their place', async () => {
    const { host } = await render({
      effects: {
        dust: dust({ amount: 2, size: 1, speed: 1 }),
        lamp: { ...saved({ amount: 3 }), title: 'Lamp lit' },
      },
    })
    const reset = button(rowOf(host, 'Dust'), 'Reset')!
    await act(async () => reset.focus())
    await click(reset)
    expect(button(rowOf(host, 'Dust'), 'Reset')).toBeUndefined()
    expect(document.activeElement).toBe(switchFor(host, 'Dust')!)
  })

  it('keeps an effect’s settings while it is switched off, and brings them back on', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 2, size: 1, speed: 1 }) },
    })
    await click(switchFor(host, 'Dust'))
    expect(sliderFor(host, 'Amount')).toBeUndefined()
    expect(host.querySelector('.movement-settings')!.textContent).toContain('Amount 0–3 (1)')
    expect(puts.at(-1)).toEqual({
      effects: { dust: { ...dust({ amount: 2, size: 1, speed: 1 }, false), title: 'Dust' } },
    })
    expect(calls().setEffects.at(-1)).toEqual([])
    await click(switchFor(host, 'Dust'))
    expect(valueOf(host, 'Amount')).toBe('2.00')
  })

  it('tells how many effects the renderer has that are in the game, to the page', async () => {
    const counts: (number | null)[] = []
    const { host } = await render({
      effects: { dust: dust({ amount: 1 }), gone: dust({}) },
      onEffectsOn: (n) => counts.push(n),
    })
    expect(counts.at(-1)).toBe(1)
    await click(switchFor(host, 'Mist'))
    expect(counts.at(-1)).toBe(2)
  })

  it('lists an effect the renderer no longer has last, with Remove, outside the numbers, and removes it', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 1 }), ghost: dust({ strength: 2 }) },
    })
    const rows = [...host.querySelectorAll('.movement-side .movement-effect')]
    const last = rows.at(-1)!
    expect(last.textContent).toContain('ghost')
    expect(last.textContent).toContain(
      "The project's renderer no longer has this effect, so the game won't show it. Its settings are kept until you remove it.",
    )
    expect(last.querySelector('input')).toBeNull()
    expect(text(host)).toContain("1 of the renderer's 4 are on.")
    await click(button(host, 'Remove'))
    expect(host.textContent).not.toContain('ghost')
    expect(puts).toEqual([{ effects: { dust: dust({ amount: 1 }) } }])
  })

  it('shows the slider at the nearest end of a range it has left, says so until it is moved', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 3.5, size: 1, speed: 1 }) },
    })
    expect(valueOf(host, 'Amount')).toBe('3.00')
    expect(text(host)).toContain(
      'Amount was saved as 3.50; the renderer now goes up to 3, so the game plays 3.',
    )
    expect(puts).toEqual([])
    await move(sliderFor(host, 'Amount')!, 2.5)
    expect(text(host)).not.toContain('was saved as')
    expect(puts.at(-1)!.effects.dust!.settings.amount).toBe(2.5)
  })

  it('says the effects could not be saved, keeps the change on the picture, and saves again with Try again', async () => {
    let fail = true
    const { host, puts } = await render({
      saved: () =>
        fail
          ? Response.json({ ok: false, problems: [] }, { status: 409 })
          : Response.json({ ok: true }),
    })
    await click(switchFor(host, 'Dust'))
    expect(text(host)).toContain(
      "Couldn't save the effects: the image edits file can't be written. Your last change is still on the picture.",
    )
    expect(calls().setEffects.at(-1)).toHaveLength(1)
    expect(switchFor(host, 'Dust')!.checked).toBe(true)
    fail = false
    await click(button(host, 'Try again'))
    expect(puts).toHaveLength(2)
    expect(puts[1]).toEqual(puts[0]!)
    expect(text(host)).not.toContain("Couldn't save")
    expect(text(host)).toContain('Saved')
  })

  it('says “Saving…” only when a save takes more than a moment', async () => {
    let release: () => void = () => {}
    const { host } = await render({
      saved: () => new Promise((resolve) => (release = () => resolve(Response.json({ ok: true })))),
    })
    await click(switchFor(host, 'Dust'))
    expect(text(host)).not.toContain('Saving…')
    await act(async () => await new Promise((r) => setTimeout(r, 450)))
    expect(text(host)).toContain('Saving…')
    await act(async () => release())
    await settle()
    expect(text(host)).toContain('Saved')
    expect(text(host)).not.toContain('Saving…')
  })

  it('names what is saved when the renderer could not load, and the plain line when nothing is', async () => {
    const failed = { named: true as const, ok: false as const, file: 'r.js', message: 'boom' }
    const a = await render({
      answer: failed,
      effects: {
        fireflies: { ...dust({}), title: 'Fireflies' },
        mist: dust({}, false),
        ripples: { ...dust({}), title: 'Pond ripples' },
      },
    })
    expect(text(a.host)).toContain(
      'Saved for the game: Fireflies, Pond ripples. They can be changed once the renderer loads.',
    )
    expect(text(a.host)).not.toContain('None: the renderer did not load.')
    const b = await render({ answer: failed })
    expect(text(b.host)).toContain('None: the renderer did not load.')
  })

  it('hands the stage the effects in the order the game gets them, by kind', async () => {
    const { host } = await render()
    await click(switchFor(host, 'Mist'))
    await click(switchFor(host, 'Fire'))
    expect(
      calls()
        .setEffects.at(-1)!
        .map((e) => e.kind),
    ).toEqual(['fire', 'mist'])
  })

  it('saves a drag that ends without a release, and stops waiting for one', async () => {
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    const amount = sliderFor(host, 'Amount')!
    await move(amount, 1.5, true)
    await act(async () => amount.dispatchEvent(new Event('pointercancel', { bubbles: true })))
    await settle()
    expect(puts).toHaveLength(1)
    await move(amount, 1.6)
    expect(puts).toHaveLength(2)
  })

  it('leaves Space to pause and F to full screen while a slider has focus', async () => {
    const { host } = await render({ effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) } })
    await press(' ', sliderFor(host, 'Amount')!)
    expect(button(host, '▶ Play')).toBeDefined()
  })

  it('fills in a setting the renderer has added since, when the effect is switched on again', async () => {
    const { host, puts } = await render({ effects: { dust: dust({ amount: 2 }, false) } })
    await click(switchFor(host, 'Dust'))
    expect(puts[0]!.effects.dust!.settings).toEqual({ amount: 2, size: 1, speed: 1 })
  })

  it('counts no effects for the page when the project names no renderer', async () => {
    const counts: (number | null)[] = []
    await render({
      answer: { named: false },
      effects: { dust: dust({}) },
      onEffectsOn: (n) => counts.push(n),
    })
    expect(counts.at(-1)).toBe(0)
  })

  it('can be set with no take chosen', async () => {
    const { host, puts } = await render({ chosenTake: null })
    await click(switchFor(host, 'Dust'))
    expect(puts).toHaveLength(1)
  })
})

describe('the effects in full screen', () => {
  it('shows the same switches, sliders, Reset and line, in step with the tab both ways, saving the same', async () => {
    const real = document.fullscreenElement
    void real
    let current: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
    const { host, puts } = await render({
      effects: { dust: dust({ amount: 2, size: 1, speed: 1 }) },
    })
    await click(button(host, '⛶ Full screen'))
    const panel = '.movement-float'
    expect(valueOf(host, 'Amount', panel)).toBe('2.00')
    expect(host.querySelector(`${panel}`)!.textContent).toContain('Reset')
    await move(sliderFor(host, 'Speed', panel)!, 0.5, true)
    await release(sliderFor(host, 'Speed', panel)!)
    expect(valueOf(host, 'Speed')).toBe('0.50')
    expect(puts.at(-1)!.effects.dust!.settings.speed).toBe(0.5)
    expect(host.querySelector(`${panel}`)!.textContent).toContain("1 of the renderer's 4 are on.")
  })

  describe('while the images lock cannot be read', () => {
    const LOCK =
      'Which take the game shows is not known until the images lock can be read; fix it, then reload.'
    const patches = [
      { id: 'fire', title: 'Fire', take: 2 },
      { id: 'door', title: 'Door', take: null },
    ]

    it('shows an amber frame with the lock words and plays nothing, whatever the row says', async () => {
      const { host, goneToMake } = await render({ lockUnread: true, chosenTake: null, patches })
      const frame = host.querySelector('.movement-unknown')!
      expect(frame.textContent).toContain('The images lock could not be read')
      expect(frame.textContent).toContain(LOCK)
      expect(host.querySelector('.movement-pic')).toBeNull()
      expect(host.querySelector('.movement-caption')).toBeNull()
      expect(text(host)).not.toContain('No take chosen')
      expect(button(host, 'Go to Make')).toBeUndefined()
      expect(button(host, '❚❚ Pause')).toBeUndefined()
      expect(button(host, '⛶ Full screen')).toBeUndefined()
      await press('f')
      await press(' ')
      expect(document.fullscreenElement ?? null).toBeNull()
      expect(goneToMake).toEqual([])
    })

    it('lists every patch as not known, off and greyed, with the reason', async () => {
      const { host } = await render({ lockUnread: true, patches })
      const rows = [...host.querySelectorAll('.movement-side .movement-switch')]
      expect(rows.map((r) => r.textContent)).toEqual(['Fire · not known', 'Door · not known'])
      for (const row of rows) {
        const input = row.querySelector('input')!
        expect(input.checked).toBe(false)
        expect(input.getAttribute('data-why')).toBe(
          'Which patch take is chosen is not known until the images lock can be read.',
        )
        await click(input)
        expect(input.checked).toBe(false)
      }
    })

    it('lists the saved effects read-only, writes nothing, and keeps the title count', async () => {
      const counts: (number | null)[] = []
      const { host, puts } = await render({
        lockUnread: true,
        effects: {
          fireflies: { title: 'Fireflies', on: true, settings: {} },
          ripples: { title: 'Pond ripples', on: true, settings: {} },
          dust: { title: 'Dust', on: true, settings: {} },
        },
        onEffectsOn: (c) => counts.push(c),
      })
      expect(host.querySelector('.movement-side [aria-label="Effects"] h3')!.textContent).toBe(
        'Effects',
      )
      expect(text(host)).toContain(
        'Saved for the game: Fireflies, Pond ripples, Dust. They can be changed once the images lock can be read.',
      )
      expect(host.querySelector('.movement-effect')).toBeNull()
      expect(button(host, 'Reset')).toBeUndefined()
      expect(puts).toEqual([])
      expect(counts.at(-1)).toBe(1)
    })

    it('says so when no effects are saved, keeping the Effects heading', async () => {
      const { host } = await render({ lockUnread: true })
      expect(host.querySelector('.movement-side [aria-label="Effects"] h3')!.textContent).toBe(
        'Effects',
      )
      expect(text(host)).toContain(
        'None are saved for the game. Effects can be put in once the images lock can be read.',
      )
    })

    it('says both when the renderer failed too: its failure on top of the frame, Try again stays', async () => {
      const { host } = await render({
        lockUnread: true,
        answer: { named: true, ok: false, file: 'web/r.js', message: 'web/r.js: boom' },
        effects: { fireflies: { title: 'Fireflies', on: true, settings: {} } },
      })
      const frame = host.querySelector('.movement-unknown')!
      expect(frame.firstElementChild!.textContent).toContain(
        'The motion renderer could not be loaded.',
      )
      expect(frame.textContent).toContain(LOCK)
      // Only the lock heading is amber; the renderer failure keeps its own colour.
      expect(frame.querySelectorAll('.movement-unknown-heading')).toHaveLength(1)
      expect(frame.querySelector('.movement-failure strong')?.className ?? '').not.toContain(
        'movement-unknown-heading',
      )
      expect(button(host, 'Try again')).toBeDefined()
      expect(text(host)).toContain('They can be changed once the images lock can be read.')
      expect(text(host)).not.toContain('once the renderer loads')
    })

    it('is as before when the lock can be read and no take is chosen', async () => {
      const { host } = await render({ chosenTake: null, patches })
      expect(host.querySelector('.movement-unknown')).toBeNull()
      expect(text(host)).toContain('No take chosen yet')
      expect(text(host)).toContain('Door · no take chosen')
    })
  })
})

describe('an effect tied to a patch', () => {
  const PATCHES = [
    { id: 'star', title: 'The star on the door', take: 2 },
    { id: 'lantern', title: 'Broken lantern', take: null },
  ]
  const tied = (patch: string, title: string, on = true) => ({
    dust: {
      ...dust({ amount: 1, size: 1, speed: 1 }, on),
      title: 'Dust',
      patch,
      patchTitle: title,
    },
  })
  const menu = (host: HTMLElement, within = '.movement-side') =>
    host.querySelector<HTMLSelectElement>(`${within} .movement-effect select`)
  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
  }
  const dustRow = (host: HTMLElement) => host.querySelector('.movement-side .movement-effect')!
  const playing = () =>
    calls()
      .setEffects.at(-1)!
      .map((e) => e.kind)

  it('has a Shows menu on an effect that is on, Always first then each patch in the game’s order', async () => {
    const { host } = await render({
      patches: PATCHES,
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    const select = menu(host)!
    expect(dustRow(host).querySelector('.movement-shows label')!.textContent).toBe('Shows')
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Always',
      'While The star on the door is laid',
      'While The star on the door is not laid',
      'While Broken lantern is laid',
      'While Broken lantern is not laid',
    ])
    expect(select.value).toBe('')
    expect(dustRow(host).querySelector('.movement-tag')).toBeNull()
  })

  it('styles the Shows menu as the studio’s other drop-downs, the take count on Make', async () => {
    const { host } = await render({
      patches: PATCHES,
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    expect(menu(host)!.classList.contains('takes-count')).toBe(true)
  })

  it('has no menu while the effect is off, and none on an image with no patches', async () => {
    const off = await render({ patches: PATCHES })
    expect(menu(off.host)).toBeNull()
    const none = await render({ effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) } })
    expect(menu(none.host)).toBeNull()
  })

  it('saves a choice at once, lays the patch in the preview and tags the effect', async () => {
    const { host, puts } = await render({
      patches: PATCHES,
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    await choose(menu(host)!, 'with:star')
    expect(puts.at(-1)!.effects.dust).toEqual({
      ...saved({ amount: 1, size: 1, speed: 1 }),
      patch: 'star',
      patchTitle: 'The star on the door',
    })
    expect(text(host)).toContain('Saved')
    expect(switchFor(host, 'The star on the door')!.checked).toBe(true)
    expect(dustRow(host).querySelector('.movement-tag')!.textContent).toBe(
      'with The star on the door',
    )
    expect(playing()).toEqual(['dust'])
    await choose(menu(host)!, '')
    expect(puts.at(-1)!.effects.dust).toEqual(saved({ amount: 1, size: 1, speed: 1 }))
    expect(dustRow(host).querySelector('.movement-tag')).toBeNull()
  })

  it('counts a tied effect that is on for the tab, whether or not its patch is laid', async () => {
    const counts: (number | null)[] = []
    const { host } = await render({
      patches: PATCHES,
      effects: tied('star', 'The star on the door'),
      onEffectsOn: (c) => counts.push(c),
    })
    expect(playing()).toEqual([])
    expect(counts.at(-1)).toBe(1)
    await click(button(host, 'Lay it'))
    expect(counts.at(-1)).toBe(1)
  })

  it('runs only while the patch is laid, dims the sliders and offers Lay it, which keeps focus on the menu', async () => {
    const { host, puts } = await render({
      patches: PATCHES,
      effects: tied('star', 'The star on the door'),
    })
    expect(playing()).toEqual([])
    expect(dustRow(host).className).toContain('movement-effect-dim')
    expect(dustRow(host).textContent).toContain("Not showing: The star on the door isn't laid.")
    const before = puts.length
    await click(button(host, 'Lay it'))
    expect(switchFor(host, 'The star on the door')!.checked).toBe(true)
    expect(playing()).toEqual(['dust'])
    expect(button(host, 'Lay it')).toBeUndefined()
    expect(dustRow(host).className).not.toContain('movement-effect-dim')
    expect(document.activeElement).toBe(menu(host))
    expect(puts.length).toBe(before)
    await click(switchFor(host, 'The star on the door'))
    expect(playing()).toEqual([])
  })

  it('can be tied to a patch with no take, which lays nothing and has no button', async () => {
    const { host } = await render({
      patches: PATCHES,
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
    })
    await choose(menu(host)!, 'with:lantern')
    expect(dustRow(host).textContent).toContain(
      'Not showing: Broken lantern has no take chosen yet.',
    )
    expect(button(host, 'Lay it')).toBeUndefined()
    expect(dustRow(host).className).toContain('movement-effect-dim')
    expect(playing()).toEqual([])
  })

  it('keeps the tie, with its tag and no menu, while the effect is switched off, and counts it when on', async () => {
    const { host, puts } = await render({
      patches: PATCHES,
      effects: tied('star', 'The star on the door'),
    })
    expect(text(host)).toContain("1 of the renderer's 4 are on.")
    await click(switchFor(host, 'Dust'))
    expect(menu(host)).toBeNull()
    expect(dustRow(host).querySelector('.movement-tag')!.textContent).toBe(
      'with The star on the door',
    )
    expect(puts.at(-1)!.effects.dust!.patch).toBe('star')
    await click(switchFor(host, 'Dust'))
    expect(menu(host)!.value).toBe('with:star')
  })

  it('keeps a tie to a patch the game no longer lists, flagged, until another choice is made', async () => {
    const { host, puts } = await render({
      patches: PATCHES,
      effects: tied('old', 'Old sign'),
    })
    expect(dustRow(host).className).toContain('movement-effect-lost')
    expect(dustRow(host).querySelector('.movement-tag')!.textContent).toBe('with Old sign')
    expect([...menu(host)!.options].map((o) => o.textContent)).toEqual([
      'Always',
      'While The star on the door is laid',
      'While The star on the door is not laid',
      'While Broken lantern is laid',
      'While Broken lantern is not laid',
      'While Old sign is laid · gone',
    ])
    expect(menu(host)!.value).toBe('with:old')
    expect(dustRow(host).textContent).toContain(
      "The game no longer lists the patch Old sign, so it won't show this effect. Choose Always or another patch.",
    )
    expect(playing()).toEqual([])
    await choose(menu(host)!, '')
    expect(dustRow(host).className).not.toContain('movement-effect-lost')
    expect(puts.at(-1)!.effects.dust!.patch).toBeUndefined()
    expect([...menu(host)!.options].length).toBe(5)
  })

  it("keeps the effect's name on one line beside a long patch title, the tag wrapping below it", async () => {
    const long = 'The very long brass plaque nailed above the old tavern door'
    const { host } = await render({
      patches: [{ id: 'plaque', title: long, take: 2 }],
      effects: tied('plaque', long),
    })
    const head = dustRow(host).querySelector('.movement-effect-head')!
    expect(head.querySelector('.movement-tag')!.textContent).toBe(`with ${long}`)
    // Both shrink in one flex row; with the tag's `overflow-wrap: anywhere` the name was squeezed
    // to a letter per line. The name must not shrink, and the row must let the tag wrap below it.
    expect(
      valuesInEveryWindow(head.querySelector('.movement-switch')!, 'flex-shrink').at(-1),
    ).toEndWith(': 0')
    expect(valuesInEveryWindow(head, 'flex-wrap').at(-1)).toEndWith(': wrap')
  })

  it('keeps the tie through slider moves and Reset', async () => {
    const { host, puts } = await render({
      patches: PATCHES,
      effects: tied('star', 'The star on the door'),
    })
    await move(sliderFor(host, 'Amount')!, 2)
    expect(puts.at(-1)!.effects.dust!.patch).toBe('star')
    await click(button(host, 'Reset'))
    expect(puts.at(-1)!.effects.dust!.patch).toBe('star')
  })

  it('can still be undone when the game now lists no patches at all', async () => {
    const { host, puts } = await render({ effects: tied('old', 'Old sign') })
    expect(menu(host)!.value).toBe('with:old')
    expect(dustRow(host).textContent).toContain('The game no longer lists the patch Old sign')
    await choose(menu(host)!, '')
    expect(puts.at(-1)!.effects.dust!.patch).toBeUndefined()
  })

  it('keeps the choice on the picture when it could not be saved', async () => {
    const { host } = await render({
      patches: PATCHES,
      effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
      saved: () => Response.json({ ok: false, problems: [] }, { status: 409 }),
    })
    await choose(menu(host)!, 'with:star')
    expect(text(host)).toContain("Couldn't save the effects")
    expect(menu(host)!.value).toBe('with:star')
    expect(playing()).toEqual(['dust'])
  })

  it('takes the tie away with an effect the renderer no longer has', async () => {
    const { host, puts } = await render({
      patches: PATCHES,
      effects: { ghost: { on: true, settings: {}, patch: 'star', patchTitle: 'The star' } },
    })
    expect(host.querySelector('.movement-effect-gone select')).toBeNull()
    await click(button(host, 'Remove'))
    expect(puts.at(-1)!.effects).toEqual({})
  })

  it('shows the same menu, tag and line in full screen, in step with the tab', async () => {
    let current: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
    const { host } = await render({
      patches: PATCHES,
      effects: tied('star', 'The star on the door'),
    })
    await click(button(host, '⛶ Full screen'))
    expect(host.querySelector('.movement-float')!.textContent).toContain(
      "Not showing: The star on the door isn't laid.",
    )
    await click(
      [...host.querySelectorAll<HTMLButtonElement>('.movement-float button')].find(
        (b) => b.textContent === 'Lay it',
      ),
    )
    expect(switchFor(host, 'The star on the door')!.checked).toBe(true)
    expect(host.querySelector('.movement-side')!.textContent).not.toContain('Not showing')
    expect(menu(host, '.movement-float')!.value).toBe('with:star')
  })

  describe('shown only while a patch is not laid', () => {
    const untied = (patch: string, title: string, on = true) => ({
      dust: {
        ...dust({ amount: 1, size: 1, speed: 1 }, on),
        title: 'Dust',
        unlessPatch: patch,
        patchTitle: title,
      },
    })
    const FIRE = [
      { id: 'water', title: 'The water on the fire', take: 2 },
      { id: 'lantern', title: 'Broken lantern', take: null },
    ]

    it('saves the choice at once, switches the patch off and tags the effect', async () => {
      const { host, puts } = await render({
        patches: FIRE,
        effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
      })
      await click(switchFor(host, 'The water on the fire'))
      expect(switchFor(host, 'The water on the fire')!.checked).toBe(true)
      await choose(menu(host)!, 'without:water')
      expect(puts.at(-1)!.effects.dust).toEqual({
        ...saved({ amount: 1, size: 1, speed: 1 }),
        unlessPatch: 'water',
        patchTitle: 'The water on the fire',
      })
      expect(puts.at(-1)!.effects.dust!.patch).toBeUndefined()
      expect(text(host)).toContain('Saved')
      expect(switchFor(host, 'The water on the fire')!.checked).toBe(false)
      expect(dustRow(host).querySelector('.movement-tag')!.textContent).toBe(
        'without The water on the fire',
      )
      expect(menu(host)!.value).toBe('without:water')
      expect(playing()).toEqual(['dust'])
    })

    it('changing from one way to the other leaves only the new one', async () => {
      const { host, puts } = await render({
        patches: FIRE,
        effects: tied('water', 'The water on the fire'),
      })
      await choose(menu(host)!, 'without:water')
      expect(puts.at(-1)!.effects.dust!.patch).toBeUndefined()
      expect(puts.at(-1)!.effects.dust!.unlessPatch).toBe('water')
      await choose(menu(host)!, 'with:water')
      expect(puts.at(-1)!.effects.dust!.unlessPatch).toBeUndefined()
      expect(puts.at(-1)!.effects.dust!.patch).toBe('water')
    })

    it('stops while the patch is laid, dims the sliders, and Take it off switches it off and keeps focus on the menu', async () => {
      const counts: (number | null)[] = []
      const { host, puts } = await render({
        patches: FIRE,
        effects: untied('water', 'The water on the fire'),
        onEffectsOn: (c) => counts.push(c),
      })
      expect(playing()).toEqual(['dust'])
      expect(dustRow(host).textContent).not.toContain('Not showing')
      await click(switchFor(host, 'The water on the fire'))
      expect(playing()).toEqual([])
      expect(dustRow(host).className).toContain('movement-effect-dim')
      expect(counts.at(-1)).toBe(1)
      expect(dustRow(host).textContent).toContain('Not showing: The water on the fire is laid.')
      const before = puts.length
      await click(button(host, 'Take it off'))
      expect(switchFor(host, 'The water on the fire')!.checked).toBe(false)
      expect(playing()).toEqual(['dust'])
      expect(button(host, 'Take it off')).toBeUndefined()
      expect(dustRow(host).className).not.toContain('movement-effect-dim')
      expect(document.activeElement).toBe(menu(host))
      expect(puts.length).toBe(before)
    })

    it('runs on a patch with no take chosen, with no line and no button', async () => {
      const { host } = await render({
        patches: FIRE,
        effects: { dust: dust({ amount: 1, size: 1, speed: 1 }) },
      })
      await choose(menu(host)!, 'without:lantern')
      expect(dustRow(host).textContent).not.toContain('Not showing')
      expect(button(host, 'Take it off')).toBeUndefined()
      expect(dustRow(host).className).not.toContain('movement-effect-dim')
      expect(playing()).toEqual(['dust'])
    })

    it('keeps a choice of a patch the game no longer lists, flagged, until another is made', async () => {
      const { host, puts } = await render({
        patches: FIRE,
        effects: untied('old', 'Old bucket'),
      })
      expect(dustRow(host).className).toContain('movement-effect-lost')
      expect(dustRow(host).className).toContain('movement-effect-dim')
      expect(dustRow(host).querySelector('.movement-tag')!.textContent).toBe('without Old bucket')
      expect([...menu(host)!.options].map((o) => o.textContent)).toEqual([
        'Always',
        'While The water on the fire is laid',
        'While The water on the fire is not laid',
        'While Broken lantern is laid',
        'While Broken lantern is not laid',
        'While Old bucket is not laid · gone',
      ])
      expect(menu(host)!.value).toBe('without:old')
      expect(dustRow(host).textContent).toContain(
        'The game no longer lists the patch Old bucket. Choose Always or another patch.',
      )
      expect(playing()).toEqual([])
      await choose(menu(host)!, '')
      expect(dustRow(host).className).not.toContain('movement-effect-lost')
      expect(puts.at(-1)!.effects.dust!.unlessPatch).toBeUndefined()
    })

    it('keeps the choice, with its tag and no menu, while the effect is off, and through sliders', async () => {
      const { host, puts } = await render({
        patches: FIRE,
        effects: untied('water', 'The water on the fire'),
      })
      await click(switchFor(host, 'Dust'))
      expect(menu(host)).toBeNull()
      expect(dustRow(host).querySelector('.movement-tag')!.textContent).toBe(
        'without The water on the fire',
      )
      expect(puts.at(-1)!.effects.dust!.unlessPatch).toBe('water')
      await click(switchFor(host, 'Dust'))
      expect(menu(host)!.value).toBe('without:water')
    })

    it('shows the same menu, tag and line in full screen, in step with the tab', async () => {
      let current: Element | null = null
      Object.defineProperty(document, 'fullscreenElement', {
        get: () => current,
        configurable: true,
      })
      ;(
        HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
      ).requestFullscreen = async function (this: Element) {
        current = this
        document.dispatchEvent(new Event('fullscreenchange'))
      }
      cleanups.push(() => {
        current = null
        delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown })
          .requestFullscreen
      })
      const { host } = await render({
        patches: FIRE,
        effects: untied('water', 'The water on the fire'),
      })
      await click(button(host, '⛶ Full screen'))
      await click(switchFor(host, 'The water on the fire'))
      const float = host.querySelector('.movement-float')!
      expect(float.textContent).toContain('Not showing: The water on the fire is laid.')
      expect(float.textContent).toContain('without The water on the fire')
      await click(
        [...float.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent === 'Take it off',
        ),
      )
      expect(switchFor(host, 'The water on the fire')!.checked).toBe(false)
      expect(host.querySelector('.movement-side')!.textContent).not.toContain('Not showing')
      expect(menu(host, '.movement-float')!.value).toBe('without:water')
    })
  })
})

const POND: [number, number][] = [
  [0.1, 0.5],
  [0.4, 0.5],
  [0.25, 0.9],
]

describe('an effect with a spot, played', () => {
  it('runs on a canvas of its own, the others on the one over the whole picture', async () => {
    const { host } = await render({
      effects: {
        dust: { ...dust({ amount: 1, size: 1, speed: 1 }), spot: [POND] },
        mist: { on: true, settings: { amount: 1 } },
      },
    })
    expect(calls().made).toBe(2)
    const asked = calls().setEffects.map((s) => s.map((e) => e.kind).join())
    expect(asked).toContain('mist')
    expect(asked).toContain('dust')
    expect(asked).not.toContain('dust,mist')
    const canvases = host.querySelectorAll<HTMLCanvasElement>('.movement-canvas')
    expect(canvases).toHaveLength(2)
  })

  it('hands the renderer the spot, and leaves its canvas unclipped, so the effect is placed as in the game', async () => {
    const { host } = await render({
      effects: {
        dust: { ...dust({ amount: 1, size: 1, speed: 1 }), spot: [POND] },
        mist: { on: true, settings: { amount: 1 } },
      },
    })
    const handed = calls().setEffects.flat()
    expect(handed.find((e) => e.kind === 'dust')!.spot).toEqual([POND])
    expect(handed.find((e) => e.kind === 'mist')!.spot).toBeUndefined()
    const canvases = host.querySelectorAll<HTMLCanvasElement>('.movement-canvas')
    expect([...canvases].map((c) => c.style.clipPath)).toEqual(['', ''])
    expect(host.querySelector('clipPath')).toBeNull()
  })

  it('leaves nothing of a taken-out effect on a paused canvas, by running its fade out at once', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: { dust: saved({ amount: 1 }), mist: { on: true, settings: {} } },
    })
    await click(button(host, '❚❚ Pause'))
    const steps = calls().stepMs.length
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(calls().setEffects.at(-1)!).toEqual([])
    expect(
      calls()
        .stepMs.slice(steps)
        .some((ms) => ms >= 1000),
    ).toBe(true)
  })

  it('plays an effect over the whole picture again once its spot is gone', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] } },
    })
    expect(host.querySelectorAll('.movement-canvas')).toHaveLength(2)
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(
      calls()
        .setEffects.at(-1)!
        .map((e) => e.kind),
    ).toEqual(['dust'])
    expect(host.querySelectorAll('.movement-canvas')).toHaveLength(1)
  })

  it('plays no effect over the whole picture while it is off', async () => {
    const { host } = await render({
      effects: { dust: { ...dust({ amount: 1, size: 1, speed: 1 }), on: false, spot: [POND] } },
    })
    expect(calls().made).toBe(1)
    expect(host.querySelectorAll('.movement-canvas')).toHaveLength(1)
  })
})

/** The effect row of the side column with this name. */
const rowOf = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('.movement-side .movement-effect')].find(
    (r) => r.querySelector('.movement-switch')?.textContent === name,
  ) as HTMLElement
const spotLineOf = (host: HTMLElement, name: string) =>
  rowOf(host, name).querySelector('.movement-spot')?.textContent ?? null
const linkIn = (row: Element, label: string) =>
  [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)
const SQUARE: [number, number][] = [
  [0.6, 0.6],
  [0.9, 0.6],
  [0.9, 0.9],
  [0.6, 0.9],
]

describe('the spot line of an effect', () => {
  it('says the whole picture with Draw a spot while the effect is on and has no spot', async () => {
    const { host } = await render({ effects: { dust: saved({ amount: 1 }) } })
    expect(spotLineOf(host, 'Dust')).toBe(
      "Spot: the game's — the game doesn't say where" + 'Draw your own',
    )
    expect(spotLineOf(host, 'Mist')).toBeNull()
  })

  it('counts the shapes, with Change and Back to the game’s, which saves at once with no question and offers Undo', async () => {
    const { host, puts } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] } },
    })
    expect(spotLineOf(host, 'Dust')).toBe("Spot: your own, 1 shapeChangeBack to the game's")
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(puts.at(-1)!.effects.dust).toEqual(saved({ amount: 1 }))
    expect(spotLineOf(host, 'Dust')).toBe(
      "Spot: the game's — the game doesn't say whereDraw your own · Your shape was removed.Undo",
    )
  })

  it('Back to the game’s leaves keyboard focus on that row’s Draw your own', async () => {
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] } },
    })
    const clear = linkIn(rowOf(host, 'Dust'), "Back to the game's")!
    await act(async () => clear.focus())
    await click(clear)
    expect(document.activeElement?.textContent).toBe('Draw your own')
    expect(rowOf(host, 'Dust').contains(document.activeElement)).toBe(true)
  })

  it('says “2 shapes” for two', async () => {
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND, SQUARE] } },
    })
    expect(spotLineOf(host, 'Dust')).toStartWith('Spot: your own, 2 shapes')
  })

  it('keeps the spot while the effect is off, said so, with no links', async () => {
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }, false), spot: [POND, SQUARE] } },
    })
    expect(spotLineOf(host, 'Dust')).toBe('Spot: your own, 2 shapes (kept while off)')
    await click(switchFor(host, 'Dust'))
    expect(spotLineOf(host, 'Dust')).toStartWith('Spot: your own, 2 shapesChange')
  })

  it('keeps the spot when a slider moves or Reset is pressed', async () => {
    const { host, puts } = await render({
      effects: { dust: { ...saved({ amount: 2, size: 1, speed: 1 }), spot: [POND] } },
    })
    await click(linkIn(rowOf(host, 'Dust'), 'Reset'))
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([POND])
  })

  it('greys Draw a spot with the reason when there is no picture at all', async () => {
    const { host } = await render({ chosenTake: null, effects: { dust: saved({ amount: 1 }) } })
    const link = linkIn(rowOf(host, 'Dust'), 'Draw your own')!
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(text(rowOf(host, 'Dust'))).toContain('Choose a take on Make to draw a spot.')
  })

  it('has the same spot links in the full-screen panel', async () => {
    let current: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] }, mist: saved({ amount: 1 }) },
    })
    await click(button(host, '⛶ Full screen'))
    const panel = host.querySelector('.movement-float')!
    const lines = [...panel.querySelectorAll('.movement-spot')].map((l) => l.textContent)
    expect(lines).toEqual([
      "Spot: your own, 1 shapeChangeBack to the game's",
      "Spot: the game's — the game doesn't say whereDraw your own",
    ])
  })
})

/** The overlay the shapes are drawn and clicked on: 640 x 400 on screen, as the canvas is. */
const overlay = (host: HTMLElement) => host.querySelector<HTMLElement>('.spot-overlay')!
function sizeOverlay() {
  const was = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    return {
      left: 0,
      top: 0,
      right: 640,
      bottom: 400,
      width: 640,
      height: 400,
      x: 0,
      y: 0,
    } as DOMRect
  }
  cleanups.push(() => (Element.prototype.getBoundingClientRect = was))
}
/** A pointer event on the overlay at fractions of the picture. */
async function pointer(host: HTMLElement, type: string, x: number, y: number) {
  await act(async () => {
    const event = new MouseEvent(type, {
      clientX: x * 640,
      clientY: y * 400,
      bubbles: true,
      cancelable: true,
    })
    overlay(host).dispatchEvent(event)
  })
}
/** A click: a press and a letting go at the same place. */
async function tap(host: HTMLElement, x: number, y: number) {
  await pointer(host, 'pointerdown', x, y)
  await pointer(host, 'pointerup', x, y)
}
/** What the bar says and shows, without the unseen room it holds for its other steps. */
const barText = (host: HTMLElement) => {
  const bar = host.querySelector('.spot-bar')?.cloneNode(true) as HTMLElement | undefined
  bar?.querySelectorAll('.spot-bar-room').forEach((r) => r.remove())
  return bar?.textContent ?? null
}
const polygons = (host: HTMLElement, cls: string) => host.querySelectorAll(`polygon.${cls}`)

describe('drawing a spot', () => {
  const withDust = (spot?: [number, number][][]) => ({
    effects: { dust: { ...saved({ amount: 1 }), ...(spot && { spot }) } },
  })

  it('goes straight to placing a first shape, with Finish focused, and closes it on the first corner', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(barText(host)).toBe(
      'Drawing your own spot for Dust. Click to place each corner; click the first corner to close the shape. Esc stops this shape.❚❚ PauseFinish',
    )
    expect(document.activeElement?.textContent).toBe('Finish')
    expect(spotLineOf(host, 'Dust')).toBe(
      "Spot: the game's — the game doesn't say where · drawing now",
    )
    await tap(host, 0.1, 0.5)
    await tap(host, 0.4, 0.5)
    await tap(host, 0.25, 0.9)
    expect(puts).toHaveLength(0)
    await tap(host, 0.1, 0.5)
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([
      [
        [0.1, 0.5],
        [0.4, 0.5],
        [0.25, 0.9],
      ],
    ])
    expect(barText(host)).toContain('Drawing your own spot for Dust.')
    expect(spotLineOf(host, 'Dust')).toBe('Spot: your own, 1 shape · drawing now')
    expect(button(host, 'Delete this shape')).toBeDefined()
  })

  it('still counts an effect whose spot is being drawn with no shape yet', async () => {
    sizeOverlay()
    const counts: (number | null)[] = []
    const { host } = await render({
      effects: { dust: saved({ amount: 1 }), mist: saved({}) },
      onEffectsOn: (n) => counts.push(n),
    })
    expect(counts.at(-1)).toBe(2)
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(counts.at(-1)).toBe(2)
  })

  it('does not close a shape with fewer than three corners', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    await tap(host, 0.1, 0.5)
    await tap(host, 0.4, 0.5)
    await tap(host, 0.1, 0.5)
    expect(puts).toHaveLength(0)
    expect(barText(host)).toContain('New shape for Dust.')
  })

  it('opens drawing on a spot with its words, Add a shape focused, and the first shape picked', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(barText(host)).toBe(
      'Drawing your own spot for Dust. Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it. Drag the ● to where the light comes from, or press Alt and the arrows.❚❚ Pause＋ Add a shapeDelete this shapeLight from the middleFinish',
    )
    expect(document.activeElement?.textContent).toBe('＋ Add a shape')
    expect(rowOf(host, 'Dust').className).toContain('movement-effect-drawing')
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-still')).toBe('true')
  })

  it('shows an own shape’s corners at once on Change, and a corner drags without a click first', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([SQUARE]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(host.querySelectorAll('.spot-corner')).toHaveLength(4)
    await pointer(host, 'pointerdown', 0.9, 0.6)
    await pointer(host, 'pointermove', 1, 0.3)
    await pointer(host, 'pointerup', 1, 0.3)
    expect(puts.at(-1)!.effects.dust!.spot![0]![1]).toEqual([1, 0.3])
  })

  it('hands the renderer the spot again when a shape is added while it plays', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.1)
    await tap(host, 0.9, 0.1)
    await tap(host, 0.9, 0.4)
    await tap(host, 0.6, 0.1)
    const dustSpot = calls()
      .setEffects.at(-1)!
      .find((e) => e.kind === 'dust')!.spot
    expect(dustSpot).toEqual([
      POND,
      [
        [0.6, 0.1],
        [0.9, 0.1],
        [0.9, 0.4],
      ],
    ])
  })

  it('picks a shape by a click in it and un-picks by a click outside every shape', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    expect(button(host, 'Delete this shape')).toBeDefined()
    expect(host.querySelectorAll('.spot-corner')).toHaveLength(3)
    await tap(host, 0.8, 0.2)
    expect(button(host, 'Delete this shape')).toBeUndefined()
    expect(host.querySelectorAll('.spot-corner')).toHaveLength(0)
  })

  it('asks before deleting a shape, and Delete saves; the last one puts the effect on the whole picture', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await click(button(host, 'Delete this shape'))
    expect(barText(host)).toBe('Delete this shape? It has 3 corners.Keep itDelete')
    await click(button(host, 'Keep it'))
    expect(barText(host)).toContain('Drawing your own spot for Dust.')
    expect(puts).toHaveLength(0)
    await click(button(host, 'Delete this shape'))
    await click(button(host, 'Delete'))
    expect(puts.at(-1)!.effects.dust!.spot).toBeUndefined()
    expect(spotLineOf(host, 'Dust')).toBe(
      "Spot: the game's — the game doesn't say where · drawing now",
    )
    expect(barText(host)).toContain('Drawing your own spot for Dust.')
  })

  it('anchors the shown buttons to the top of the bar and the delete question to its bottom, by their layer', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    const buttons = host.querySelector('.spot-bar-buttons')!
    const shown = () => buttons.querySelector('.spot-bar-now')!
    // Narrow, the room is two lines tall: the shown layer sits at its top, not stretched down it.
    expect(valuesInEveryWindow(shown(), 'align-self').at(-1)).toEndWith(': start')
    expect(shown().classList.contains('spot-bar-ask')).toBe(false)
    // The words' own layer is not one of the buttons' layers.
    const words = host.querySelector('.spot-bar-words > .spot-bar-now')!
    expect(valuesInEveryWindow(words, 'align-self')).toEqual([])
    await click(button(host, 'Delete this shape'))
    // Keep it and Delete are the bar's other layer, anchored to its last line, where Light from the
    // middle and Finish are: a quick second press where Delete this shape was lands on neither.
    expect([...shown().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Keep it',
      'Delete',
    ])
    expect(shown().classList.contains('spot-bar-ask')).toBe(true)
    expect(valuesInEveryWindow(shown(), 'align-self').at(-1)).toEndWith(': end')
    // No per-step alignment of the layer's lines is left to agree with the layers.
    expect(valuesInEveryWindow(shown(), 'align-content').at(-1)).toBeUndefined()
    expect(valuesInEveryWindow(shown(), 'align-items').at(-1)).toBeUndefined()
  })

  it('draws the held room from the same list as the shown buttons, in the same order', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    // The room's buttons wrap in the order Pause, Add a shape, Delete this shape, Light from the middle,
    // Finish, so Delete this shape is never on the room's last line, where the question packs.
    const order = [
      '❚❚ Pause',
      '＋ Add a shape',
      'Delete this shape',
      'Light from the middle',
      'Finish',
    ]
    const room = host.querySelector('.spot-bar-buttons > .spot-bar-room')!
    expect([...room.children].map((b) => b.textContent)).toEqual(order)
    const shown = host.querySelector('.spot-bar-buttons > .spot-bar-now')!
    expect([...shown.querySelectorAll('button')].map((b) => b.textContent)).toEqual(order)
    // Each held button keeps the look of the one it stands for.
    expect([...room.children].map((b) => b.className)).toEqual(
      [...shown.querySelectorAll('button')].map((b) => b.className),
    )
  })

  it('moves a corner by dragging it, saving once on letting go, and keeps it on the picture', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await pointer(host, 'pointerdown', 0.4, 0.5)
    await pointer(host, 'pointermove', 0.5, 0.4)
    expect(puts).toHaveLength(0)
    await pointer(host, 'pointermove', 1.3, 0.3)
    await pointer(host, 'pointerup', 1.3, 0.3)
    expect(puts).toHaveLength(1)
    expect(puts[0]!.effects.dust!.spot![0]![1]).toEqual([1, 0.3])
  })

  it('takes a corner out on a double-click, but keeps three', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([SQUARE]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.75, 0.75)
    await pointer(host, 'dblclick', 0.9, 0.6)
    expect(puts.at(-1)!.effects.dust!.spot![0]).toHaveLength(3)
    const count = puts.length
    await pointer(host, 'dblclick', 0.9, 0.9)
    expect(puts).toHaveLength(count)
  })

  it('takes Pause and Full screen off the picture while a spot is drawn, and brings them back after (as-tldl)', async () => {
    sizeOverlay()
    const { host } = await render(withDust([SQUARE]))
    expect(host.querySelector('.movement-buttons')).not.toBeNull()
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(host.querySelector('.movement-buttons')).toBeNull()
    await click(button(host, 'Finish'))
    expect(host.querySelector('.movement-buttons')).not.toBeNull()
  })

  it('gives every press on the picture to the drawing, whatever kind: place, close, grab a corner, grab the mark, pick a shape (as-tldl)', async () => {
    sizeOverlay()
    const low: [number, number][] = [
      [0.02, 0.97],
      [0.4, 0.5],
      [0.97, 0.97],
    ]
    const { host, puts } = await render(withDust([low, SQUARE]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    // One overlay owns the presses: it takes them over the whole picture, and no second raised layer,
    // catcher or per-element opt-in is left (happy-dom does no hit testing, so the stylesheet is pinned).
    expect(valuesInEveryWindow(overlay(host), 'pointer-events').at(-1)).toMatch(/: auto$/)
    expect(host.querySelector('.spot-handles, .spot-catch, .spot-grab')).toBeNull()
    for (const cls of ['.spot-corner', '.spot-mark'])
      expect(valuesInEveryWindow(host.querySelector(cls)!, 'pointer-events')).toEqual([])
    // Pick the other shape near the stage foot, then back; the picked outline moves each time.
    const pickedIndex = () =>
      [...polygons(host, 'spot-edge')].findIndex((p) => p.classList.contains('spot-edge-picked'))
    await tap(host, 0.88, 0.89)
    expect(pickedIndex()).toBe(1)
    await tap(host, 0.4, 0.8)
    expect(pickedIndex()).toBe(0)
    // Grab a corner at the foot and drag it.
    await pointer(host, 'pointerdown', 0.02, 0.97)
    await pointer(host, 'pointermove', 0.2, 0.7)
    await pointer(host, 'pointerup', 0.2, 0.7)
    expect(puts.at(-1)!.effects.dust!.spot![0]![0]).toEqual([0.2, 0.7])
    // Grab the mark (the middle of the shape's box) and drag it.
    const at = host.querySelector('.spot-mark')!.getAttribute('data-at')!.split(',').map(Number)
    await pointer(host, 'pointerdown', at[0]!, at[1]!)
    await pointer(host, 'pointermove', 0.05, 0.95)
    await pointer(host, 'pointerup', 0.05, 0.95)
    expect(puts.at(-1)!.effects.dust!.mark).toEqual([0.05, 0.95])
    // Place and close a second shape low on the picture, where the buttons were.
    await click(button(host, '＋ Add a shape'))
    for (const [x, y] of [
      [0.03, 0.97],
      [0.5, 0.6],
      [0.97, 0.97],
      [0.03, 0.97],
    ] as const)
      await tap(host, x, y)
    expect(puts.at(-1)!.effects.dust!.spot).toHaveLength(3)
    expect(puts.at(-1)!.effects.dust!.spot![2]).toEqual([
      [0.03, 0.97],
      [0.5, 0.6],
      [0.97, 0.97],
    ])
  })

  it('adds a second shape and picks it when it closes', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    expect(barText(host)).toContain('New shape for Dust.')
    for (const [x, y] of SQUARE) await tap(host, x, y)
    await tap(host, SQUARE[0]![0], SQUARE[0]![1])
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([POND, SQUARE])
    expect(spotLineOf(host, 'Dust')).toBe('Spot: your own, 2 shapes · drawing now')
    expect(host.querySelectorAll('.spot-corner')).toHaveLength(4)
  })

  it('leaves an unclosed shape out on Finish, says so, and returns focus to Change', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.6)
    await tap(host, 0.9, 0.6)
    await click(button(host, 'Finish'))
    expect(host.querySelector('.spot-bar')).toBeNull()
    expect(puts).toHaveLength(0)
    expect(text(rowOf(host, 'Dust'))).toContain("The shape you hadn't closed was left out.")
    expect(document.activeElement?.textContent).toBe('Change')
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-still')).toBeNull()
  })

  it('stops a shape on Esc without a word, and leaves drawing on the next Esc', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.6)
    await press('Escape')
    expect(barText(host)).toContain('Drawing your own spot for Dust.')
    expect(text(rowOf(host, 'Dust'))).not.toContain('left out')
    await press('Escape')
    expect(host.querySelector('.spot-bar')).toBeNull()
  })

  it('greys the other rows’ links while one effect is being drawn, saying which', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: {
        dust: { ...saved({ amount: 1 }), spot: [POND] },
        mist: { on: true, settings: {} },
      },
    })
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    const link = linkIn(rowOf(host, 'Mist'), 'Draw your own')!
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(text(rowOf(host, 'Mist'))).toContain('Finish the Dust spot first.')
    await click(link)
    expect(barText(host)).toContain('Dust')
  })

  it('takes the other effects out of the picture, and holds a spotless one out until a shape is closed', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: {
        dust: { ...saved({ amount: 1 }), spot: [POND] },
        mist: { on: true, settings: {} },
      },
    })
    await click(linkIn(rowOf(host, 'Mist'), 'Draw your own'))
    expect(calls().setEffects.at(-1)!).toEqual([])
    expect(host.querySelectorAll('.movement-canvas')).toHaveLength(1)
  })

  it('says the spot could not be saved, keeps the shape, and saves again with Try again', async () => {
    sizeOverlay()
    let ok = false
    const { host, puts } = await render({
      ...withDust([POND]),
      saved: () =>
        ok
          ? Response.json({ ok: true })
          : Response.json({ ok: false, problems: [] }, { status: 409 }),
    })
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await click(button(host, 'Delete this shape'))
    await click(button(host, 'Delete'))
    expect(text(host)).toContain(
      "Couldn't save the spot: the image edits file can't be written. Your shape is still on the picture.",
    )
    expect(barText(host)).toContain('Drawing your own spot for Dust.')
    ok = true
    await click(button(host, 'Try again'))
    expect(text(host)).not.toContain("Couldn't save the spot")
    expect(puts.length).toBe(2)
  })

  it('outlines an effect’s shapes while its row is pointed at, with no dots, and not after', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND, SQUARE]))
    expect(polygons(host, 'spot-peek')).toHaveLength(0)
    await act(async () => {
      rowOf(host, 'Dust').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    expect(polygons(host, 'spot-peek')).toHaveLength(2)
    expect(host.querySelectorAll('.spot-corner')).toHaveLength(0)
    await act(async () => {
      rowOf(host, 'Dust').dispatchEvent(new MouseEvent('pointerout', { bubbles: true }))
    })
    expect(polygons(host, 'spot-peek')).toHaveLength(0)
  })

  it('saves where a fast drag ended even when no render came between the moves and the release', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await act(async () => {
      const send = (type: string, x: number, y: number) =>
        overlay(host).dispatchEvent(
          new MouseEvent(type, { clientX: x * 640, clientY: y * 400, bubbles: true }),
        )
      send('pointerdown', 0.4, 0.5)
      send('pointermove', 0.45, 0.45)
      send('pointermove', 0.5, 0.4)
      send('pointerup', 0.5, 0.4)
    })
    expect(puts.at(-1)!.effects.dust!.spot![0]![1]).toEqual([0.5, 0.4])
  })

  it('hands the renderer only the effect being drawn, and every effect that is on after Finish', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] }, mist: saved({}) },
    })
    // Dust plays on a canvas of its own, Mist on the one over the whole picture; each scene is told its set.
    const kinds = (from: number) =>
      calls()
        .setEffects.slice(from)
        .map((set) => set.map((e) => e.kind).join())
    const before = calls().setEffects.length
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(kinds(before)).toEqual([''])
    const drawn = calls().setEffects.length
    await click(button(host, 'Finish'))
    expect(kinds(drawn)).toEqual(['mist'])
  })

  it('shows Pause / Play first in the drawing bar, with Space and the caption in step', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    const caption = () => host.querySelector('.movement-caption')!.textContent
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    const first = () => host.querySelector<HTMLButtonElement>('.spot-bar-buttons button')!
    expect(first().textContent).toBe('❚❚ Pause')
    expect(caption()).toBe('Take 3, as the game will show it. Space pauses · F for full screen.')
    first().focus()
    await click(first())
    expect(first().textContent).toBe('▶ Play')
    expect(document.activeElement).toBe(first())
    expect(caption()).toBe(
      'Take 3, as the game will show it. Paused · Space plays · F for full screen.',
    )
    await press(' ')
    expect(first().textContent).toBe('❚❚ Pause')
    await press(' ')
    expect(first().textContent).toBe('▶ Play')
    // Finish leaves it paused: the stage's own button says so, and so does the caption.
    await click(button(host, 'Finish'))
    expect(button(host, '▶ Play')).toBeDefined()
    expect(caption()).toContain('Paused · Space plays')
  })

  it('keeps Pause / Play off the delete question, and on the placing bar', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    expect(barText(host)).toContain('❚❚ PauseFinish')
    await tap(host, 0.1, 0.1)
    await tap(host, 0.2, 0.1)
    await tap(host, 0.2, 0.2)
    await tap(host, 0.1, 0.1)
    await click(button(host, 'Delete this shape'))
    expect(barText(host)).toEndWith('Keep itDelete')
    await press(' ')
    expect(host.querySelector('.movement-caption')!.textContent).toContain('Paused')
  })

  it('finishes drawing when an effect being drawn is switched off', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(switchFor(host, 'Dust'))
    expect(host.querySelector('.spot-bar')).toBeNull()
    expect(spotLineOf(host, 'Dust')).toBe('Spot: your own, 1 shape (kept while off)')
  })

  it('clears the left-out line at the next change of that spot', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.6)
    await click(button(host, 'Finish'))
    expect(text(rowOf(host, 'Dust'))).toContain('left out')
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(text(rowOf(host, 'Dust'))).not.toContain('left out')
  })

  it('outlines the shapes while keyboard focus is in the row', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    const link = linkIn(rowOf(host, 'Dust'), 'Change')!
    await act(async () => link.focus())
    expect(polygons(host, 'spot-peek')).toHaveLength(1)
    await act(async () => link.blur())
    expect(polygons(host, 'spot-peek')).toHaveLength(0)
  })

  it('finishes drawing when the tab is left', async () => {
    sizeOverlay()
    const { host, setOpen } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await setOpen(false)
    await setOpen(true)
    expect(host.querySelector('.spot-bar')).toBeNull()
  })
})

describe('the light mark of a spot', () => {
  const withDust = (spot: [number, number][][], mark?: [number, number], on = true) => ({
    effects: { dust: { ...saved({ amount: 1 }, on), spot, ...(mark && { mark }) } },
  })
  const markAt = (host: HTMLElement) => host.querySelector('.spot-mark')?.getAttribute('data-at')
  const lineOf = (host: HTMLElement) => spotLineOf(host, 'Dust')
  async function alt(key: string) {
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }),
      )
    })
    await settle()
  }
  /** Drags from one point to another on the overlay. */
  async function drag(host: HTMLElement, from: [number, number], to: [number, number]) {
    await pointer(host, 'pointerdown', ...from)
    await pointer(host, 'pointermove', ...to)
    await pointer(host, 'pointerup', ...to)
  }
  const middle = (host: HTMLElement) => button(host, 'Light from the middle')!

  it('shows at the middle of the shapes once one is closed, with Light from the middle greyed', async () => {
    sizeOverlay()
    const { host } = await render({ effects: { dust: saved({ amount: 1 }) } })
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(host.querySelector('.spot-mark')).toBeNull()
    await tap(host, 0.1, 0.5)
    await tap(host, 0.4, 0.5)
    await tap(host, 0.25, 0.9)
    await tap(host, 0.1, 0.5)
    expect(markAt(host)).toBe('0.25,0.7')
    expect(host.querySelector('.spot-mark-ring')).not.toBeNull()
    expect(middle(host).getAttribute('aria-disabled')).toBe('true')
    expect(lineOf(host)).toBe('Spot: your own, 1 shape · drawing now')
  })

  it('says its words in the bar, and shows Delete this shape only with a shape picked', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(barText(host)).toBe(
      'Drawing your own spot for Dust. Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it. Drag the ● to where the light comes from, or press Alt and the arrows.❚❚ Pause＋ Add a shapeDelete this shapeLight from the middleFinish',
    )
    await tap(host, 0.8, 0.2)
    expect(barText(host)).toEndWith('＋ Add a shapeLight from the middleFinish')
  })

  it('is dragged anywhere on the picture, saved on release, and said on the line', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    const before = puts.length
    await pointer(host, 'pointerdown', 0.25, 0.7)
    await pointer(host, 'pointermove', 0.8, 0.1)
    expect(puts).toHaveLength(before)
    await pointer(host, 'pointerup', 0.8, 0.1)
    expect(puts.at(-1)!.effects.dust!.mark).toEqual([0.8, 0.1])
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([POND])
    expect(markAt(host)).toBe('0.8,0.1')
    expect(middle(host).getAttribute('aria-disabled')).toBeNull()
    expect(lineOf(host)).toBe('Spot: your own, 1 shape, light from a marked point · drawing now')
  })

  it('stays within the picture’s edges', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await drag(host, [0.25, 0.7], [1.4, -0.3])
    expect(puts.at(-1)!.effects.dust!.mark).toEqual([1, 0])
  })

  it('moves with Alt and the arrows, each press saved, and plain arrows do nothing', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await press('ArrowRight')
    expect(puts).toHaveLength(0)
    await alt('ArrowRight')
    await alt('ArrowDown')
    expect(puts).toHaveLength(2)
    expect(puts.at(-1)!.effects.dust!.mark).toEqual([0.26, 0.71])
  })

  it('picks the shape under it when pressed and let go without moving', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.7)
    expect(button(host, 'Delete this shape')).toBeDefined()
  })

  it('is not grabbed while a new shape is being placed: the press places a corner', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND], [0.8, 0.1]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await drag(host, [0.8, 0.1], [0.5, 0.5])
    await tap(host, 0.8, 0.1)
    expect(puts).toHaveLength(0)
    expect(markAt(host)).toBe('0.8,0.1')
  })

  it('is not nudged by Alt and the arrows typed in a text field', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    const field = document.createElement('input')
    document.body.append(field)
    cleanups.push(() => field.remove())
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }),
      )
    })
    expect(puts).toHaveLength(0)
  })

  it('reads a mark with no shapes as the whole picture', async () => {
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), mark: [0.8, 0.1] as [number, number] } },
    })
    expect(lineOf(host)).toBe("Spot: the game's — the game doesn't say whereDraw your own")
  })

  it('goes back to the middle with Light from the middle, saved at once', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND], [0.8, 0.1]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(markAt(host)).toBe('0.8,0.1')
    await click(middle(host))
    expect(puts.at(-1)!.effects.dust).toEqual({ ...saved({ amount: 1 }), spot: [POND] })
    expect(markAt(host)).toBe('0.25,0.7')
    expect(middle(host).getAttribute('aria-disabled')).toBe('true')
  })

  it('stays on the same spot of the picture when a corner moves or a shape is added', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND], [0.8, 0.1]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await drag(host, [0.4, 0.5], [0.5, 0.45])
    expect(puts.at(-1)!.effects.dust!.mark).toEqual([0.8, 0.1])
    await click(button(host, '＋ Add a shape'))
    for (const [x, y] of [
      [0.6, 0.6],
      [0.9, 0.6],
      [0.9, 0.9],
      [0.6, 0.6],
    ] as const)
      await tap(host, x, y)
    expect(puts.at(-1)!.effects.dust!.mark).toEqual([0.8, 0.1])
  })

  it('keeps following the middle while it was never moved, as shapes change', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    for (const [x, y] of [
      [0.6, 0.6],
      [0.9, 0.6],
      [0.9, 0.9],
      [0.6, 0.6],
    ] as const)
      await tap(host, x, y)
    expect(markAt(host)).toBe('0.5,0.7')
  })

  it('goes with the shapes when the last is deleted', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND], [0.8, 0.1]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await click(button(host, 'Delete this shape'))
    await click(button(host, 'Delete'))
    expect(puts.at(-1)!.effects.dust).toEqual(saved({ amount: 1 }))
    expect(host.querySelector('.spot-mark')).toBeNull()
  })

  it('goes with the shapes on Clear', async () => {
    const { host, puts } = await render(withDust([POND], [0.8, 0.1]))
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(puts.at(-1)!.effects.dust).toEqual(saved({ amount: 1 }))
  })

  it('says on the row whether the mark was moved', async () => {
    const moved = await render(withDust([POND, SQUARE], [0.8, 0.1]))
    expect(lineOf(moved.host)).toBe(
      "Spot: your own, 2 shapes, light from a marked pointChangeBack to the game's",
    )
    const unmoved = await render(withDust([POND]))
    expect(lineOf(unmoved.host)).toBe("Spot: your own, 1 shapeChangeBack to the game's")
  })

  it('is kept while the effect is off, said so', async () => {
    const { host } = await render(withDust([POND], [0.8, 0.1], false))
    expect(lineOf(host)).toBe('Spot: your own, 1 shape, light from a marked point (kept while off)')
  })

  it('shows a small dot with no ring when its row is pointed at, only if it was moved', async () => {
    sizeOverlay()
    const over = async (host: HTMLElement) =>
      act(async () => {
        rowOf(host, 'Dust').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      })
    const moved = await render(withDust([POND], [0.8, 0.1]))
    await over(moved.host)
    expect(moved.host.querySelector('.spot-peek-mark')).not.toBeNull()
    expect(moved.host.querySelector('.spot-mark-ring')).toBeNull()
    const unmoved = await render(withDust([POND]))
    await over(unmoved.host)
    expect(polygons(unmoved.host, 'spot-peek')).toHaveLength(1)
    expect(unmoved.host.querySelector('.spot-peek-mark')).toBeNull()
  })

  it('is handed to the renderer with the spot, and only when moved', async () => {
    await render(withDust([POND], [0.8, 0.1]))
    expect(
      calls()
        .setEffects.at(-1)!
        .find((e) => e.kind === 'dust')!.mark,
    ).toEqual([0.8, 0.1])
    await render(withDust([POND]))
    expect(
      calls()
        .setEffects.at(-1)!
        .find((e) => e.kind === 'dust')!.mark,
    ).toBeUndefined()
  })

  it('keeps the mark where it was put and drawing open when the save fails', async () => {
    sizeOverlay()
    const { host } = await render({
      ...withDust([POND]),
      saved: () => Response.json({ ok: false, problems: [] }, { status: 409 }),
    })
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await drag(host, [0.25, 0.7], [0.8, 0.1])
    expect(text(host)).toContain("Couldn't save the spot")
    expect(markAt(host)).toBe('0.8,0.1')
    expect(barText(host)).toContain('Drawing your own spot for Dust.')
  })

  it('is on the line, with no links, in the full-screen panel', async () => {
    let current: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
    const { host } = await render(withDust([POND], [0.8, 0.1]))
    await click(button(host, '⛶ Full screen'))
    const lines = [...host.querySelectorAll('.movement-float .movement-spot')].map(
      (l) => l.textContent,
    )
    expect(lines).toEqual([
      "Spot: your own, 1 shape, light from a marked pointChangeBack to the game's",
    ])
  })
})

describe('the slow zoom of an image', () => {
  const group = (host: HTMLElement) =>
    host.querySelector<HTMLElement>('.movement-side [aria-label="Slow zoom"]')!
  const style = (host: HTMLElement) => host.querySelector<HTMLElement>('.movement-zoom')!.style
  const own = { on: true, seconds: 24, percent: 5 }

  it('is the first group of the side column, above Patches and Effects, on the game’s own values with no chip or Reset', async () => {
    const { host, zoomPuts } = await render({ patches: [{ id: 'fire', title: 'Fire', take: 2 }] })
    const groups = [...host.querySelectorAll('.movement-side .movement-group')].map((g) =>
      g.getAttribute('aria-label'),
    )
    expect(groups).toEqual(['Slow zoom', 'Patches', 'Effects'])
    expect(group(host).querySelector('h3')!.textContent).toBe('Slow zoom')
    expect(switchFor(host, 'Zoom in and out')!.checked).toBe(true)
    expect(valueOf(host, 'Each way')).toBe('16 s')
    expect(valueOf(host, 'How far')).toBe('3%')
    expect(group(host).querySelector('.movement-save')).toBeNull()
    expect(button(group(host), 'Reset')).toBeUndefined()
    expect(zoomPuts).toEqual([])
    expect(style(host).getPropertyValue('--zoom-seconds')).toBe('16s')
    expect(style(host).getPropertyValue('--zoom-scale')).toBe('1.03')
  })

  it('sets the sliders’ ranges and steps, and counts nothing in the tab’s effects', async () => {
    const counts: (number | null)[] = []
    const { host } = await render({ onEffectsOn: (n) => counts.push(n) })
    const seconds = sliderFor(host, 'Each way')!
    expect([seconds.min, seconds.max, seconds.step]).toEqual(['4', '60', '1'])
    const far = sliderFor(host, 'How far')!
    expect([far.min, far.max, far.step]).toEqual(['0.5', '10', '0.5'])
    expect(counts.at(-1)).toBe(0)
  })

  it('follows a slider live and saves once on letting go', async () => {
    const { host, zoomPuts } = await render({ zoom: own })
    const far = sliderFor(host, 'How far')!
    await move(far, 7, true)
    expect(valueOf(host, 'How far')).toBe('7%')
    expect(style(host).getPropertyValue('--zoom-scale')).toBe('1.07')
    expect(zoomPuts).toEqual([])
    await release(far)
    expect(zoomPuts).toEqual([{ zoom: { on: true, seconds: 24, percent: 7 } }])
    expect(text(group(host))).toContain('Saved')
  })

  it('saves every step moved with the keyboard', async () => {
    const { host, zoomPuts } = await render({ zoom: own })
    await move(sliderFor(host, 'Each way')!, 25)
    await move(sliderFor(host, 'Each way')!, 26)
    expect(zoomPuts.map((p) => p.zoom!.seconds)).toEqual([25, 26])
  })

  it('saves the switch at once, keeps the values and says so, and the picture stands still', async () => {
    const { host, zoomPuts } = await render({ zoom: own })
    await click(switchFor(host, 'Zoom in and out'))
    expect(zoomPuts).toEqual([{ zoom: { on: false, seconds: 24, percent: 5 } }])
    expect(text(group(host))).toContain(
      "Off: the picture stands still in the game. 24 s each way · 5% kept for when it's back on.",
    )
    expect(sliderFor(host, 'Each way')).toBeUndefined()
    expect(button(group(host), 'Reset')).toBeDefined()
    expect(text(group(host))).toContain('Saved')
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-still')).toBe('true')
    await click(switchFor(host, 'Zoom in and out'))
    expect(valueOf(host, 'Each way')).toBe('24 s')
    expect(zoomPuts.at(-1)).toEqual({ zoom: own })
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-still')).toBeNull()
  })

  it('shows Reset only while it differs from on, 16 s and 3%, and takes the image back to nothing saved', async () => {
    const { host, zoomPuts } = await render({ zoom: own })
    await click(button(group(host), 'Reset'))
    expect(zoomPuts).toEqual([{ zoom: null }])
    expect(valueOf(host, 'Each way')).toBe('16 s')
    expect(valueOf(host, 'How far')).toBe('3%')
    expect(button(group(host), 'Reset')).toBeUndefined()
    const same = await render({ zoom: { on: true, seconds: 16, percent: 3 } })
    expect(button(group(same.host), 'Reset')).toBeUndefined()
  })

  it('puts focus on the switch after Reset, so a keyboard user keeps their place', async () => {
    const { host } = await render({ zoom: own })
    const reset = button(group(host), 'Reset')!
    reset.focus()
    await click(reset)
    expect(button(group(host), 'Reset')).toBeUndefined()
    expect(document.activeElement).toBe(switchFor(host, 'Zoom in and out')!)
  })

  it('draws Reset as a link that adds no height to the switch row, so appearing moves neither slider', async () => {
    const { host } = await render({ zoom: own })
    const reset = button(group(host), 'Reset')!
    expect(reset.classList.contains('link-button')).toBe(true)
    expect(reset.classList.contains('btn')).toBe(false)
    // A button's 36 px minimum height made the row taller than the switch and pushed the sliders down.
    expect(valuesInEveryWindow(reset, 'min-height')).toEqual([])
    for (const property of ['height', 'line-height', 'padding', 'padding-block', 'border']) {
      expect(valuesInEveryWindow(reset, property)).toEqual([])
    }
  })

  it('says “Saving…” only when the save takes a moment', async () => {
    let done: () => void = () => {}
    const { host } = await render({
      zoom: own,
      zoomSaved: () =>
        new Promise((resolve) => (done = () => resolve(Response.json({ ok: true })))),
    })
    await click(switchFor(host, 'Zoom in and out'))
    expect(text(group(host))).not.toContain('Saving…')
    await act(async () => await new Promise((r) => setTimeout(r, 450)))
    expect(text(group(host))).toContain('Saving…')
    await act(async () => done())
    await settle()
    expect(text(group(host))).toContain('Saved')
  })

  it('says it could not be saved, keeps the change on the picture, and saves again with Try again', async () => {
    let fail = true
    const { host, zoomPuts } = await render({
      zoom: own,
      zoomSaved: () =>
        fail
          ? Response.json({ ok: false, problems: [] }, { status: 409 })
          : Response.json({ ok: true }),
    })
    await move(sliderFor(host, 'How far')!, 8)
    expect(text(group(host))).toContain(
      "Couldn't save the slow zoom: the image edits file can't be written. Your last change is still on the picture.",
    )
    expect(style(host).getPropertyValue('--zoom-scale')).toBe('1.08')
    fail = false
    await click(button(group(host), 'Try again'))
    expect(zoomPuts).toHaveLength(2)
    expect(zoomPuts[1]).toEqual(zoomPuts[0]!)
    expect(text(group(host))).not.toContain("Couldn't save")
  })

  it('still shows and plays when the renderer did not load or has no effects', async () => {
    const failed = await render({
      answer: { named: true, ok: false, file: 'web/motion.ts', message: 'boom' },
    })
    expect(switchFor(failed.host, 'Zoom in and out')).toBeDefined()
    expect(sliderFor(failed.host, 'Each way')).toBeDefined()
    const none = await render({ answer: { named: true, ok: true, code: RENDERER('[]') } })
    expect(sliderFor(none.host, 'How far')).toBeDefined()
  })

  it('holds the zoom still while paused', async () => {
    const { host } = await render()
    await click(button(host, '❚❚ Pause'))
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-paused')).toBe('true')
  })

  it('shows the Saved chip as long as a zoom is saved, even before anything is pressed, and none when nothing is', async () => {
    const saved = await render({ zoom: own })
    expect(group(saved.host).querySelector('.movement-save')!.textContent).toBe('Saved')
    await settle()
    await act(async () => await new Promise((r) => setTimeout(r, 2100)))
    expect(group(saved.host).querySelector('.movement-save')!.textContent).toBe('Saved')
    const hand = await render({ zoom: { on: true, seconds: 90, percent: 12 } })
    expect(group(hand.host).querySelector('.movement-save')!.textContent).toBe('Saved')
    const none = await render()
    expect(group(none.host).querySelector('.movement-save')).toBeNull()
  })

  it('plays what the game plays for a hand-edited 0%: no depth, and the slider at its end', async () => {
    const { host } = await render({ zoom: { on: true, seconds: 16, percent: 0 } })
    expect(style(host).getPropertyValue('--zoom-scale')).toBe('1')
    expect(valueOf(host, 'How far')).toBe('0.5%')
    expect(text(group(host))).not.toContain('How far was saved')
  })

  it('keeps the saved numbers in the off line of a hand-edited zoom', async () => {
    const { host } = await render({ zoom: { on: false, seconds: 90, percent: 12 } })
    expect(text(group(host))).toContain('90 s each way · 12% kept')
  })

  it('stands still while a spot is drawn, whatever the zoom is saved as', async () => {
    const { host } = await render({
      zoom: own,
      effects: { fire: { title: 'Fire', on: true, settings: {} } },
    })
    await click(host.querySelector<HTMLElement>('[data-spot-link="fire"]'))
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-still')).toBe('true')
    expect(style(host).getPropertyValue('--zoom-scale')).toBe('')
  })

  it('sits at the nearest end of the game’s range for a value edited by hand, and says what the game plays', async () => {
    const { host } = await render({ zoom: { on: true, seconds: 90, percent: 12 } })
    expect(valueOf(host, 'Each way')).toBe('60 s')
    expect(valueOf(host, 'How far')).toBe('10%')
    expect(text(group(host))).toContain(
      'Each way was saved as 90 s; the game goes up to 60, so it plays 60.',
    )
    expect(text(group(host))).toContain(
      'How far was saved as 12%; the game goes up to 10, so it plays 10.',
    )
  })

  it('is read-only while the images record cannot be read, with what is saved', async () => {
    const saved = await render({ lockUnread: true, zoom: own })
    expect(text(group(saved.host))).toContain(
      'Saved for the game: 24 s each way, 5%. It can be changed once the images record can be read.',
    )
    expect(group(saved.host).querySelector('input')).toBeNull()
    expect(button(group(saved.host), 'Reset')).toBeUndefined()
    const off = await render({ lockUnread: true, zoom: { ...own, on: false } })
    expect(text(group(off.host))).toContain('Saved for the game: no zoom. It can be changed')
    const none = await render({ lockUnread: true })
    expect(text(group(none.host))).toContain('Saved for the game: 16 s each way, 3%.')
  })

  it('is shown in the full-screen panel too, in step with the tab', async () => {
    let current: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
    const { host, zoomPuts } = await render({ zoom: own })
    await click(button(host, '⛶ Full screen'))
    const float = host.querySelector<HTMLElement>('.movement-float')!
    expect(float.querySelector('.movement-group h3')!.textContent).toBe('Slow zoom')
    const input = [...float.querySelectorAll('.movement-switch')]
      .find((s) => s.textContent === 'Zoom in and out')!
      .querySelector('input')!
    await click(input)
    expect(zoomPuts.at(-1)).toEqual({ zoom: { on: false, seconds: 24, percent: 5 } })
  })
})

/** A renderer that says where the game places each effect: dust in a band, mist over the picture, fire nowhere else, water not at all. */
const BAND: [number, number][][] = [
  [
    [0.1, 0.7],
    [0.9, 0.7],
    [0.9, 0.9],
    [0.1, 0.9],
  ],
]
const PLACED = `[
  { type: 'dust', title: 'Dust', spot: false, placement: ${JSON.stringify(BAND)}, settings: [${setting('amount', 'Amount')}] },
  { type: 'mist', title: 'Mist', spot: false, placement: 'whole', settings: [${setting('amount', 'Amount')}] },
  { type: 'fire', title: 'Fire', spot: false, placement: 'fixed', settings: [${setting('amount', 'Amount')}] },
  { type: 'water', title: 'Running water', spot: false, settings: [${setting('amount', 'Amount')}] },
]`
const placed = { named: true as const, ok: true as const, code: RENDERER(PLACED) }
const named = (_type: string, title: string, shapes?: [number, number][][]) => ({
  title,
  on: true,
  settings: { amount: 1 },
  ...(shapes && { spot: shapes }),
})
/** Points at an effect's row, as a mouse does. */
async function pointAt(host: HTMLElement, name: string) {
  await act(async () => {
    rowOf(host, name).dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  })
}

describe('the game’s shape of an effect', () => {
  const everyEffect = () => ({
    answer: placed,
    effects: {
      dust: named('dust', 'Dust'),
      mist: named('mist', 'Mist'),
      fire: named('fire', 'Fire'),
      water: named('water', 'Running water'),
    },
  })

  it('says whose shape each row plays in, with Draw your own where the game can be overridden', async () => {
    const { host } = await render(everyEffect())
    expect(spotLineOf(host, 'Dust')).toBe("Spot: the game'sDraw your own")
    expect(spotLineOf(host, 'Mist')).toBe("Spot: the game's — the whole pictureDraw your own")
    expect(spotLineOf(host, 'Running water')).toBe(
      "Spot: the game's — the game doesn't say whereDraw your own",
    )
    expect(spotLineOf(host, 'Fire')).toBe(
      "Spot: the game's — this effect can't be moved in the studio",
    )
  })

  it('offers only Remove it for an effect the game cannot move that has an earlier shape, and keeps the shape out of the game', async () => {
    const { host, puts } = await render({
      answer: placed,
      effects: { fire: named('fire', 'Fire', [POND]) },
    })
    expect(spotLineOf(host, 'Fire')).toBe(
      "Spot: the game's — this effect can't be moved in the studio. A shape drawn earlier is kept but not used.Remove it",
    )
    expect(linkIn(rowOf(host, 'Fire'), 'Draw your own')).toBeUndefined()
    // A save marks it, so the shape stays in the studio's edits but is not exported.
    await click(switchFor(host, 'Fire'))
    await click(switchFor(host, 'Fire'))
    expect(puts.at(-1)!.effects.fire).toMatchObject({ spot: [POND], fixed: true })
    await click(linkIn(rowOf(host, 'Fire'), 'Remove it'))
    expect(puts.at(-1)!.effects.fire).toEqual({ ...named('fire', 'Fire'), fixed: true })
    expect(spotLineOf(host, 'Fire')).toContain(' · Your shape was removed.Undo')
  })

  it('hands the renderer no shape for the game’s own, and none for an effect it cannot move', async () => {
    await render({
      answer: placed,
      effects: { dust: named('dust', 'Dust'), fire: named('fire', 'Fire', [POND]) },
    })
    const last = calls().setEffects.at(-1)!
    expect(last.find((e) => e.kind === 'dust')!.spot).toBeUndefined()
    expect(last.find((e) => e.kind === 'fire')!.spot).toBeUndefined()
  })

  it('outlines the game’s shape dashed while its row is pointed at, and nothing otherwise', async () => {
    sizeOverlay()
    const { host } = await render(everyEffect())
    expect(polygons(host, 'spot-game')).toHaveLength(0)
    await pointAt(host, 'Dust')
    expect(polygons(host, 'spot-game')).toHaveLength(1)
    expect(polygons(host, 'spot-game-faint')).toHaveLength(0)
    await pointAt(host, 'Mist')
    expect(polygons(host, 'spot-game')[0]!.getAttribute('points')).toBe('0,0 640,0 640,400 0,400')
    await pointAt(host, 'Running water')
    expect(polygons(host, 'spot-game')).toHaveLength(0)
    expect(polygons(host, 'spot-peek')).toHaveLength(0)
  })

  it('outlines your own shape solid with the game’s faint beneath', async () => {
    sizeOverlay()
    const { host } = await render({
      answer: placed,
      effects: { dust: named('dust', 'Dust', [POND]) },
    })
    await pointAt(host, 'Dust')
    expect(polygons(host, 'spot-peek')).toHaveLength(1)
    expect(polygons(host, 'spot-game-faint')).toHaveLength(1)
  })

  it('starts drawing from a copy of the game’s shape, saving nothing until it is changed', async () => {
    sizeOverlay()
    const { host, puts } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(barText(host)).toBe(
      "Drawing your own spot for Dust. It starts as the game's: drag a corner to move it, double-click a corner to take it out, click the picture to add a shape.❚❚ Pause＋ Add a shapeDelete this shapeLight from the middleFinish",
    )
    expect(polygons(host, 'spot-edge')).toHaveLength(1)
    expect(polygons(host, 'spot-game-faint')).toHaveLength(1)
    expect(spotLineOf(host, 'Dust')).toBe("Spot: the game's · drawing now")
    await click(button(host, 'Finish'))
    expect(puts).toHaveLength(0)
    expect(spotLineOf(host, 'Dust')).toBe("Spot: the game'sDraw your own")
  })

  it('shows the copy’s corners at once, with the shape picked', async () => {
    sizeOverlay()
    const { host } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(host.querySelectorAll('.spot-corner')).toHaveLength(4)
    expect(polygons(host, 'spot-edge-picked')).toHaveLength(1)
  })

  it('keeps the effect moving while its spot is drawn from a copy of the game’s shape', async () => {
    sizeOverlay()
    const { host } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(
      calls()
        .setEffects.at(-1)!
        .map((e) => e.kind),
    ).toEqual(['dust'])
    const before = calls().steps
    await settle()
    expect(calls().steps).toBeGreaterThan(before)
  })

  it('makes the copy your own at the first change, saved at once', async () => {
    sizeOverlay()
    const { host, puts } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    await pointer(host, 'pointerdown', 0.9, 0.7)
    await pointer(host, 'pointermove', 0.8, 0.6)
    await pointer(host, 'pointerup', 0.8, 0.6)
    expect(puts).toHaveLength(1)
    expect(puts[0]!.effects.dust!.spot).toEqual([
      [
        [0.1, 0.7],
        [0.8, 0.6],
        [0.9, 0.9],
        [0.1, 0.9],
      ],
    ])
    expect(spotLineOf(host, 'Dust')).toBe('Spot: your own, 1 shape · drawing now')
    // The copy is now the shape the renderer is handed.
    expect(
      calls()
        .setEffects.at(-1)!
        .find((e) => e.kind === 'dust')!.spot,
    ).toHaveLength(1)
  })

  it('holds room in the bar for every step of drawing, so the picture below stays put', async () => {
    sizeOverlay()
    const { host } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    const bar = host.querySelector('.spot-bar')!
    const room = [...bar.querySelectorAll('.spot-bar-room')]
    // The words of every step and the widest row of buttons are in the bar, unseen and unread…
    expect(room.map((r) => r.textContent)).toEqual([
      "Drawing your own spot for Dust. It starts as the game's: drag a corner to move it, double-click a corner to take it out, click the picture to add a shape.",
      'Drawing your own spot for Dust. Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it. Drag the ● to where the light comes from, or press Alt and the arrows.',
      'Drawing your own spot for Dust. Click to place each corner; click the first corner to close the shape. Esc stops this shape.',
      'New shape for Dust. Click to place each corner; click the first corner to close the shape. Esc stops this shape.',
      'Delete this shape? It has 4 corners.',
      '❚❚ Pause＋ Add a shapeDelete this shapeLight from the middleFinish',
    ])
    for (const r of room) {
      expect(r.getAttribute('aria-hidden')).toBe('true')
      expect(r.querySelectorAll('button')).toHaveLength(0)
      expect(valuesInEveryWindow(r, 'visibility').at(-1)).toEndWith(': hidden')
    }
    // …each in the one cell with what the bar says and shows now, so the bar is as tall as the
    // tallest of them whichever step is shown, and the stage under it does not move.
    for (const cell of ['.spot-bar-words', '.spot-bar-buttons']) {
      expect(valuesInEveryWindow(bar.querySelector(cell)!, 'display').at(-1)).toEndWith(': grid')
    }
    const now = [...bar.querySelectorAll('.spot-bar-now')]
    expect(now).toHaveLength(2)
    for (const cell of [...now, ...room]) {
      expect(valuesInEveryWindow(cell, 'grid-area').at(-1)).toEndWith(': 1 / 1')
    }
  })

  it('starts empty where the game does not say, with the lead sentence and the empty-spot help', async () => {
    sizeOverlay()
    const { host } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Running water'), 'Draw your own'))
    expect(barText(host)).toBe(
      'Drawing your own spot for Running water. Click to place each corner; click the first corner to close the shape. Esc stops this shape.❚❚ PauseFinish',
    )
    expect(polygons(host, 'spot-game')).toHaveLength(0)
  })

  it('moves the light after drawing from the copy, making the copy your own', async () => {
    sizeOverlay()
    const { host, puts } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
      )
    })
    expect(puts.at(-1)!.effects.dust!.spot).toEqual(BAND)
    expect(puts.at(-1)!.effects.dust!.mark).toBeDefined()
  })

  it('goes back to the game’s at once, offers Undo, and Undo brings the shapes and the mark back', async () => {
    const { host, puts } = await render({
      answer: placed,
      effects: { dust: { ...named('dust', 'Dust', [POND, SQUARE]), mark: [0.2, 0.3] } },
    })
    expect(spotLineOf(host, 'Dust')).toBe(
      "Spot: your own, 2 shapes, light from a marked pointChangeBack to the game's",
    )
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(puts.at(-1)!.effects.dust).toEqual(named('dust', 'Dust'))
    expect(spotLineOf(host, 'Dust')).toBe(
      "Spot: the game'sDraw your own · Your shape was removed.Undo",
    )
    await click(linkIn(rowOf(host, 'Dust'), 'Undo'))
    expect(puts.at(-1)!.effects.dust).toEqual({
      ...named('dust', 'Dust', [POND, SQUARE]),
      mark: [0.2, 0.3],
    })
    expect(spotLineOf(host, 'Dust')).toStartWith(
      'Spot: your own, 2 shapes, light from a marked point',
    )
  })

  it('stops offering Undo at the next action on that row', async () => {
    const { host } = await render({
      answer: placed,
      effects: { dust: named('dust', 'Dust', [POND]) },
    })
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(linkIn(rowOf(host, 'Dust'), 'Undo')).toBeDefined()
    await click(switchFor(host, 'Dust'))
    await click(switchFor(host, 'Dust'))
    expect(linkIn(rowOf(host, 'Dust'), 'Undo')).toBeUndefined()
  })

  it('keeps the row on your own when going back could not be saved, and Try again goes back', async () => {
    let ok = false
    const { host, puts } = await render({
      answer: placed,
      effects: { dust: named('dust', 'Dust', [POND]) },
      saved: () =>
        ok
          ? Response.json({ ok: true })
          : Response.json({ ok: false, problems: [] }, { status: 409 }),
    })
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    expect(text(host)).toContain(
      "Couldn't save the spot: the image edits file can't be written. Your shape is still on the picture.",
    )
    expect(spotLineOf(host, 'Dust')).toBe("Spot: your own, 1 shapeChangeBack to the game's")
    ok = true
    await click(button(host, 'Try again'))
    expect(puts.at(-1)!.effects.dust!.spot).toBeUndefined()
    expect(spotLineOf(host, 'Dust')).toStartWith("Spot: the game's")
  })

  it('does not retry a revert when a later save fails: Try again retries that save', async () => {
    sizeOverlay()
    let ok = false
    const { host, puts } = await render({
      answer: placed,
      effects: { dust: named('dust', 'Dust', [POND]) },
      saved: () =>
        ok
          ? Response.json({ ok: true })
          : Response.json({ ok: false, problems: [] }, { status: 409 }),
    })
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await tap(host, 0.25, 0.6)
    await pointer(host, 'pointerdown', 0.4, 0.5)
    await pointer(host, 'pointermove', 0.5, 0.4)
    await pointer(host, 'pointerup', 0.5, 0.4)
    ok = true
    await click(button(host, 'Try again'))
    expect(puts.at(-1)!.effects.dust!.spot).toBeDefined()
  })

  it('stops offering Undo when the tab is left', async () => {
    const { host, setOpen } = await render({
      answer: placed,
      effects: { dust: named('dust', 'Dust', [POND]) },
    })
    await click(linkIn(rowOf(host, 'Dust'), "Back to the game's"))
    await setOpen(false)
    await setOpen(true)
    expect(linkIn(rowOf(host, 'Dust'), 'Undo')).toBeUndefined()
  })

  it('shows a kept shape of an effect the game cannot move while it is off', async () => {
    const { host } = await render({
      answer: placed,
      effects: { fire: { ...named('fire', 'Fire', [POND]), on: false } },
    })
    expect(spotLineOf(host, 'Fire')).toBe(
      "Spot: the game's — this effect can't be moved in the studio (kept while off). A shape drawn earlier is kept but not used.",
    )
  })

  it('draws no light mark on the game’s copy until it is changed', async () => {
    sizeOverlay()
    const { host } = await render(everyEffect())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw your own'))
    expect(host.querySelector('.spot-mark')).toBeNull()
  })

  it('shows the line without links in full screen, and keeps the shape while the effect is off', async () => {
    const { host } = await render({
      answer: placed,
      effects: { dust: { ...named('dust', 'Dust', [POND]), on: false } },
    })
    expect(spotLineOf(host, 'Dust')).toBe('Spot: your own, 1 shape (kept while off)')
  })
})

describe('drawing a spot in full screen', () => {
  const withDust = (spot?: [number, number][][]) => ({
    effects: {
      dust: { ...saved({ amount: 1 }), ...(spot && { spot }) },
      mist: saved({ amount: 1 }),
    },
  })
  let current: Element | null = null
  function fakeFullScreen() {
    current = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    ;(document as unknown as { exitFullscreen: () => Promise<void> }).exitFullscreen = async () => {
      current = null
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      current = null
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
      delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen
    })
  }
  const float = (host: HTMLElement) => host.querySelector<HTMLElement>('.movement-float')!
  const floatRow = (host: HTMLElement, name: string) =>
    [...float(host).querySelectorAll('.movement-effect')].find(
      (r) => r.querySelector('.movement-switch')?.textContent === name,
    ) as HTMLElement
  const boxText = (host: HTMLElement) => {
    const box = float(host).querySelector('.spot-bar')?.cloneNode(true) as HTMLElement | undefined
    box?.querySelectorAll('.spot-bar-room').forEach((r) => r.remove())
    return box?.textContent ?? null
  }
  const full = async (host: HTMLElement) => click(button(host, '⛶ Full screen'))
  const inFloat = (host: HTMLElement, label: string) =>
    [...float(host).querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === label,
    )

  it('turns the panel into the drawing box, and Finish brings the rows back with focus on the link', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    expect(float(host).querySelector('.movement-effect')).toBeNull()
    expect(float(host).querySelector('.movement-float-head')).not.toBeNull()
    expect(boxText(host)).toBe(
      'Drawing your own spot for Dust. Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it. Drag the ● to where the light comes from, or press Alt and the arrows.＋ Add a shapeDelete this shapeLight from the middleFinish',
    )
    expect(host.querySelector('.spot-bar')!.closest('.movement-float')).not.toBeNull()
    expect(host.querySelectorAll('.spot-bar')).toHaveLength(1)
    expect(document.activeElement?.textContent).toBe('＋ Add a shape')
    await click(inFloat(host, 'Finish'))
    expect(floatRow(host, 'Dust')).toBeDefined()
    expect(document.activeElement).toBe(linkIn(floatRow(host, 'Dust'), 'Change') ?? null)
  })

  it('says nothing of Esc, and offers Stop this shape while placing corners', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust())
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Draw your own'))
    expect(boxText(host)).toContain(
      'Drawing your own spot for Dust. Click to place each corner; click the first corner to close the shape.',
    )
    expect(boxText(host)).not.toContain('Esc')
    await tap(host, 0.2, 0.2)
    await click(inFloat(host, 'Stop this shape'))
    expect(inFloat(host, 'Stop this shape')).toBeUndefined()
    expect(inFloat(host, 'Finish')).toBeDefined()
    await click(inFloat(host, '＋ Add a shape'))
    expect(boxText(host)).not.toContain('Esc')
    expect(inFloat(host, 'Stop this shape')).toBeDefined()
  })

  it('says New shape for … without the Esc sentence when a spot already has a shape', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await click(inFloat(host, '＋ Add a shape'))
    expect(boxText(host)).toBe(
      'New shape for Dust. Click to place each corner; click the first corner to close the shape.Stop this shapeFinish',
    )
  })

  it('keeps Esc on the tab as it was: no Stop this shape button there', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    expect(button(host, 'Stop this shape')).toBeUndefined()
    expect(barText(host)).toContain('Esc stops this shape.')
  })

  it('places a corner, drags one and closes a shape in full screen, saved as it goes', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await pointer(host, 'pointerdown', 0.25, 0.9)
    await pointer(host, 'pointermove', 0.5, 0.4)
    await pointer(host, 'pointerup', 0.5, 0.4)
    expect(puts.at(-1)!.effects.dust!.spot![0]![2]).toEqual([0.5, 0.4])
    await click(inFloat(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.6)
    await tap(host, 0.9, 0.6)
    await tap(host, 0.9, 0.9)
    await tap(host, 0.6, 0.6)
    expect(puts.at(-1)!.effects.dust!.spot).toHaveLength(2)
  })

  it('deletes a shape after asking, and moves the light with Alt and the arrows', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host, puts } = await render(withDust([POND, SQUARE]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await click(inFloat(host, 'Delete this shape'))
    expect(boxText(host)).toBe('Delete this shape? It has 3 corners.Keep itDelete')
    await click(inFloat(host, 'Keep it'))
    await click(inFloat(host, 'Delete this shape'))
    await click(inFloat(host, 'Delete'))
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([SQUARE])
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    await settle()
    expect(puts.at(-1)!.effects.dust!.mark).toBeDefined()
    await click(inFloat(host, 'Light from the middle'))
    expect(puts.at(-1)!.effects.dust!.mark).toBeUndefined()
  })

  it('has Back to the game’s and Undo in the rows', async () => {
    fakeFullScreen()
    const { host, puts } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), "Back to the game's"))
    expect(puts.at(-1)!.effects.dust!.spot).toBeUndefined()
    await click(linkIn(floatRow(host, 'Dust'), 'Undo'))
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([POND])
  })

  it('carries drawing into full screen and back, with the shape picked and corners placed', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.6)
    await press('f')
    expect(boxText(host)).toContain('New shape for Dust.')
    expect(host.querySelectorAll('.spot-placed, .spot-first')).toHaveLength(1)
    await click(inFloat(host, '✕ Close'))
    expect(host.querySelector('.movement-float')).toBeNull()
    expect(barText(host)).toContain('New shape for Dust.')
    expect(host.querySelectorAll('.spot-placed, .spot-first')).toHaveLength(1)
  })

  it('does not end drawing when the browser’s Esc reaches the page in full screen', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await press('Escape')
    expect(host.querySelector('.spot-bar')).not.toBeNull()
  })

  it('folds to a strip that keeps Finish, and says what is being drawn', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await click(inFloat(host, 'Hide'))
    expect(float(host).textContent).toContain('Drawing Dust')
    expect(inFloat(host, 'Show')).toBeDefined()
    expect(inFloat(host, 'Finish')).toBeDefined()
    expect(inFloat(host, 'Stop this shape')).toBeUndefined()
    await click(inFloat(host, 'Show'))
    await click(inFloat(host, '＋ Add a shape'))
    await click(inFloat(host, 'Hide'))
    expect(float(host).textContent).toContain('New shape for Dust')
    expect(inFloat(host, 'Stop this shape')).toBeDefined()
    await click(inFloat(host, 'Finish'))
    expect(floatRow(host, 'Dust')).toBeDefined()
  })

  it('puts the panel above the overlay that takes every press while a spot is drawn', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust())
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Draw your own'))
    const z = (el: Element | null) =>
      Number(valuesInEveryWindow(el!, 'z-index').at(-1)?.split(': ').at(-1) ?? 0)
    expect(z(float(host))).toBeGreaterThan(z(host.querySelector('.spot-overlay')))
  })

  it('shows the picture in one box with the overlay and the canvas, so the corners are the picture’s fractions', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    const stage = host.querySelector('.movement-stage')!
    expect(stage.querySelector('.spot-overlay')).not.toBeNull()
    expect(host.querySelector<HTMLElement>('.movement-wrap')!.style.getPropertyValue('--ar')).toBe(
      '1.6',
    )
  })

  it('returns Finish from the folded strip to the spot link, with the panel open', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await click(inFloat(host, 'Hide'))
    await click(inFloat(host, 'Finish'))
    expect(inFloat(host, 'Hide')).toBeDefined()
    expect(document.activeElement).toBe(linkIn(floatRow(host, 'Dust'), 'Change') ?? null)
  })

  it('has no Pause on the folded strip while corners are placed', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await click(inFloat(host, '＋ Add a shape'))
    await click(inFloat(host, 'Hide'))
    expect(float(host).querySelector('[aria-label="Pause"]')).toBeNull()
  })

  it('puts focus in the box when full screen opens while drawing', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await press('f')
    expect(float(host).contains(document.activeElement)).toBe(true)
  })

  it('opens a folded panel to show a failed save, with Try again', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host } = await render({
      ...withDust([POND]),
      saved: () => Response.json({ ok: false, problems: [] }, { status: 409 }),
    })
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await click(inFloat(host, 'Hide'))
    await pointer(host, 'pointerdown', 0.25, 0.9)
    await pointer(host, 'pointermove', 0.5, 0.4)
    await pointer(host, 'pointerup', 0.5, 0.4)
    await settle()
    expect(float(host).textContent).toContain(
      "Couldn't save the spot: the image edits file can't be written. Your shape is still on the picture.",
    )
    expect(inFloat(host, 'Hide')).toBeDefined()
    expect(inFloat(host, 'Try again')).toBeDefined()
  })

  it('finishes drawing when the tab is left', async () => {
    fakeFullScreen()
    sizeOverlay()
    const { host, setOpen } = await render(withDust([POND]))
    await full(host)
    await click(linkIn(floatRow(host, 'Dust'), 'Change'))
    await setOpen(false)
    await setOpen(true)
    expect(host.querySelector('.spot-bar')).toBeNull()
  })
})

describe('the full-screen panel’s place', () => {
  const store = new Map<string, string>()
  function fakeStorage() {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    })
  }
  function fakeFull() {
    let current: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true })
    ;(
      HTMLElement.prototype as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = async function (this: Element) {
      current = this
      document.dispatchEvent(new Event('fullscreenchange'))
    }
    cleanups.push(() => {
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen
    })
  }
  const grip = (host: HTMLElement) => host.querySelector<HTMLElement>('.movement-float-grip')!
  const move = async (el: Element, type: string, x: number, y: number) =>
    act(async () => {
      el.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
      )
    })

  it('starts at the top right with nothing remembered, and has a grip', async () => {
    fakeStorage()
    fakeFull()
    const { host } = await render({ effects: { dust: saved({ amount: 1 }) } })
    await click(button(host, '⛶ Full screen'))
    const panel = host.querySelector<HTMLElement>('.movement-float')!
    expect(panel.style.left).toBe('')
    expect(grip(host).textContent).toBe('⋮⋮')
  })

  it('moves with the grip, stays inside the screen, and is remembered', async () => {
    fakeStorage()
    fakeFull()
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    const { host } = await render({ effects: { dust: saved({ amount: 1 }) } })
    await click(button(host, '⛶ Full screen'))
    const panel = host.querySelector<HTMLElement>('.movement-float')!
    await move(grip(host), 'pointerdown', 10, 10)
    await move(grip(host), 'pointermove', 110, 60)
    await move(grip(host), 'pointerup', 110, 60)
    expect(panel.style.left).not.toBe('')
    expect(JSON.parse(store.get('content-studio.movement-float')!)).toEqual({
      left: parseFloat(panel.style.left),
      top: parseFloat(panel.style.top),
    })
    // Dragged far off the screen, it is held inside.
    await move(grip(host), 'pointerdown', 10, 10)
    await move(grip(host), 'pointermove', -5000, -5000)
    await move(grip(host), 'pointerup', -5000, -5000)
    expect(parseFloat(panel.style.left)).toBe(0)
    expect(parseFloat(panel.style.top)).toBe(0)
  })

  it('starts where it was left, on another image or after a reload', async () => {
    fakeStorage()
    fakeFull()
    store.set('content-studio.movement-float', JSON.stringify({ left: 40, top: 30 }))
    const { host } = await render({ effects: { dust: saved({ amount: 1 }) } })
    await click(button(host, '⛶ Full screen'))
    const panel = host.querySelector<HTMLElement>('.movement-float')!
    expect(panel.style.left).toBe('40px')
    expect(panel.style.top).toBe('30px')
  })
})
