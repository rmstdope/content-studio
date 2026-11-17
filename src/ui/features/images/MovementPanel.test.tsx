import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ImageRow } from '../../../core/images'
import type { MotionRendererAnswer } from '../../../core/motion'
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
  setEffects: { kind: string; settings?: Record<string, number> }[][]
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
  return { host, asked, puts, goneToMake, setOpen }
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
      expect(host.querySelector('.movement-side h3')!.textContent).toBe('Effects')
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
      expect(host.querySelector('.movement-side h3')!.textContent).toBe('Effects')
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
      'While Broken lantern is laid',
    ])
    expect(select.value).toBe('')
    expect(dustRow(host).querySelector('.movement-tag')).toBeNull()
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
    await choose(menu(host)!, 'star')
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
    await choose(menu(host)!, 'lantern')
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
    expect(menu(host)!.value).toBe('star')
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
      'While Broken lantern is laid',
      'While Old sign is laid · gone',
    ])
    expect(menu(host)!.value).toBe('old')
    expect(dustRow(host).textContent).toContain(
      "The game no longer lists the patch Old sign, so it won't show this effect. Choose Always or another patch.",
    )
    expect(playing()).toEqual([])
    await choose(menu(host)!, '')
    expect(dustRow(host).className).not.toContain('movement-effect-lost')
    expect(puts.at(-1)!.effects.dust!.patch).toBeUndefined()
    expect([...menu(host)!.options].length).toBe(3)
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
    expect(menu(host)!.value).toBe('old')
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
    await choose(menu(host)!, 'star')
    expect(text(host)).toContain("Couldn't save the effects")
    expect(menu(host)!.value).toBe('star')
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
    expect(menu(host, '.movement-float')!.value).toBe('star')
  })
})

const POND: [number, number][] = [
  [0.1, 0.5],
  [0.4, 0.5],
  [0.25, 0.9],
]

describe('an effect with a spot, played', () => {
  it('runs on a canvas of its own, clipped to its shapes, the others on the one over the whole picture', async () => {
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
    expect(canvases[0]!.style.clipPath).toBe('')
    const clip = host.querySelector('clipPath')!
    expect(clip.getAttribute('clipPathUnits')).toBe('objectBoundingBox')
    expect(clip.querySelector('polygon')!.getAttribute('points')).toBe('0.1,0.5 0.4,0.5 0.25,0.9')
    expect(canvases[1]!.style.clipPath).toContain(`#${clip.id}`)
  })

  it('leaves nothing of a held effect on the shared canvas, by running its fade out at once', async () => {
    sizeOverlay()
    const { host } = await render({ effects: { dust: saved({ amount: 1 }) } })
    const before = calls().stepMs.length
    await click(linkIn(rowOf(host, 'Dust'), 'Draw a spot'))
    expect(
      calls()
        .stepMs.slice(before)
        .some((ms) => ms >= 1000),
    ).toBe(true)
  })

  it('plays an effect over the whole picture again once its spot is gone', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] } },
    })
    expect(host.querySelectorAll('.movement-canvas')).toHaveLength(2)
    await click(linkIn(rowOf(host, 'Dust'), 'Clear'))
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
    expect(spotLineOf(host, 'Dust')).toBe('Spot: the whole picture' + 'Draw a spot')
    expect(spotLineOf(host, 'Mist')).toBeNull()
  })

  it('counts the shapes, with Change and Clear, and Clear saves at once with no question', async () => {
    const { host, puts } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND] } },
    })
    expect(spotLineOf(host, 'Dust')).toBe('Spot: 1 shapeChangeClear')
    await click(linkIn(rowOf(host, 'Dust'), 'Clear'))
    expect(puts.at(-1)!.effects.dust).toEqual(saved({ amount: 1 }))
    expect(spotLineOf(host, 'Dust')).toBe('Spot: the whole pictureDraw a spot')
  })

  it('says “2 shapes” for two', async () => {
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }), spot: [POND, SQUARE] } },
    })
    expect(spotLineOf(host, 'Dust')).toStartWith('Spot: 2 shapes')
  })

  it('keeps the spot while the effect is off, said so, with no links', async () => {
    const { host } = await render({
      effects: { dust: { ...saved({ amount: 1 }, false), spot: [POND, SQUARE] } },
    })
    expect(spotLineOf(host, 'Dust')).toBe('Spot: 2 shapes (kept while off)')
    await click(switchFor(host, 'Dust'))
    expect(spotLineOf(host, 'Dust')).toStartWith('Spot: 2 shapesChange')
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
    const link = linkIn(rowOf(host, 'Dust'), 'Draw a spot')!
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(text(rowOf(host, 'Dust'))).toContain('Choose a take on Make to draw a spot.')
  })

  it('is just the line, with no links, in the full-screen panel', async () => {
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
    expect(lines).toEqual(['Spot: 1 shape', 'Spot: the whole picture'])
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
const barText = (host: HTMLElement) => host.querySelector('.spot-bar')?.textContent ?? null
const polygons = (host: HTMLElement, cls: string) => host.querySelectorAll(`polygon.${cls}`)

describe('drawing a spot', () => {
  const withDust = (spot?: [number, number][][]) => ({
    effects: { dust: { ...saved({ amount: 1 }), ...(spot && { spot }) } },
  })

  it('goes straight to placing a first shape, with Finish focused, and closes it on the first corner', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw a spot'))
    expect(barText(host)).toBe(
      'New shape for Dust. Click to place each corner; click the first corner to close the shape. Esc stops this shape.Finish',
    )
    expect(document.activeElement?.textContent).toBe('Finish')
    expect(spotLineOf(host, 'Dust')).toBe('Spot: the whole picture · drawing now')
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
    expect(barText(host)).toContain('Drawing the spot for Dust.')
    expect(spotLineOf(host, 'Dust')).toBe('Spot: 1 shape · drawing now')
    expect(button(host, 'Delete this shape')).toBeDefined()
  })

  it('does not close a shape with fewer than three corners', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust())
    await click(linkIn(rowOf(host, 'Dust'), 'Draw a spot'))
    await tap(host, 0.1, 0.5)
    await tap(host, 0.4, 0.5)
    await tap(host, 0.1, 0.5)
    expect(puts).toHaveLength(0)
    expect(barText(host)).toContain('New shape for Dust.')
  })

  it('opens drawing on a spot with its words, Add a shape focused, and nothing to delete yet', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    expect(barText(host)).toBe(
      'Drawing the spot for Dust. Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it.＋ Add a shapeFinish',
    )
    expect(document.activeElement?.textContent).toBe('＋ Add a shape')
    expect(rowOf(host, 'Dust').className).toContain('movement-effect-drawing')
    expect(host.querySelector('.movement-zoom')!.getAttribute('data-still')).toBe('true')
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
    expect(barText(host)).toContain('Drawing the spot for Dust.')
    expect(puts).toHaveLength(0)
    await click(button(host, 'Delete this shape'))
    await click(button(host, 'Delete'))
    expect(puts.at(-1)!.effects.dust!.spot).toBeUndefined()
    expect(spotLineOf(host, 'Dust')).toBe('Spot: the whole picture · drawing now')
    expect(barText(host)).toContain('Drawing the spot for Dust.')
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

  it('adds a second shape and picks it when it closes', async () => {
    sizeOverlay()
    const { host, puts } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    expect(barText(host)).toContain('New shape for Dust.')
    for (const [x, y] of SQUARE) await tap(host, x, y)
    await tap(host, SQUARE[0]![0], SQUARE[0]![1])
    expect(puts.at(-1)!.effects.dust!.spot).toEqual([POND, SQUARE])
    expect(spotLineOf(host, 'Dust')).toBe('Spot: 2 shapes · drawing now')
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
    expect(barText(host)).toContain('Drawing the spot for Dust.')
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
    const link = linkIn(rowOf(host, 'Mist'), 'Draw a spot')!
    expect(link.getAttribute('aria-disabled')).toBe('true')
    expect(text(rowOf(host, 'Mist'))).toContain('Finish the Dust spot first.')
    await click(link)
    expect(barText(host)).toContain('Dust')
  })

  it('moves only the effect being drawn, and holds a spotless one out of the picture', async () => {
    sizeOverlay()
    const { host } = await render({
      effects: {
        dust: { ...saved({ amount: 1 }), spot: [POND] },
        mist: { on: true, settings: {} },
      },
    })
    await click(linkIn(rowOf(host, 'Mist'), 'Draw a spot'))
    const kinds = calls()
      .setEffects.at(-1)!
      .map((e) => e.kind)
    expect(kinds).not.toContain('mist')
    expect(host.querySelectorAll('.movement-canvas')).toHaveLength(2)
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
    expect(barText(host)).toContain('Drawing the spot for Dust.')
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

  it('finishes drawing when an effect being drawn is switched off', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(switchFor(host, 'Dust'))
    expect(host.querySelector('.spot-bar')).toBeNull()
    expect(spotLineOf(host, 'Dust')).toBe('Spot: 1 shape (kept while off)')
  })

  it('clears the left-out line at the next change of that spot', async () => {
    sizeOverlay()
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '＋ Add a shape'))
    await tap(host, 0.6, 0.6)
    await click(button(host, 'Finish'))
    expect(text(rowOf(host, 'Dust'))).toContain('left out')
    await click(linkIn(rowOf(host, 'Dust'), 'Clear'))
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

  it('finishes drawing when full screen opens', async () => {
    sizeOverlay()
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
    const { host } = await render(withDust([POND]))
    await click(linkIn(rowOf(host, 'Dust'), 'Change'))
    await click(button(host, '⛶ Full screen'))
    expect(host.querySelector('.spot-bar')).toBeNull()
    expect(host.querySelector('.movement-float')).not.toBeNull()
  })
})
