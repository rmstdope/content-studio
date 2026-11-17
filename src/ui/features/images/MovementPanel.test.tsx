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
    step: () => note().steps++,
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
