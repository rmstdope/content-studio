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
}

/** Renders the Movement panel of an image as the page gives it; gives what it asked of the server. */
async function render(options: Options = {}) {
  ;(globalThis as unknown as { __motion: Calls }).__motion = {
    made: 0,
    setEffects: [],
    steps: 0,
    draws: 0,
    resizes: [],
  }
  const asked: string[] = []
  const answer = options.answer ?? { named: true as const, ok: true as const, code: RENDERER(FOUR) }
  globalThis.fetch = (async (url: string) => {
    asked.push(url)
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
    } as ImageRow
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            JobOpenProvider,
            { value: open },
            createElement(MovementPanel, { row, onGoToMake: () => goneToMake.push(1) }),
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
  return { host, asked, goneToMake, setOpen }
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
    expect(text(host)).toContain(
      "The project's renderer has 4. Try them here; nothing is saved yet.",
    )
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
    expect(text(host)).toContain("The project's renderer has 4.")
    expect(text(host)).not.toContain('Try them here')
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
    expect(group.querySelectorAll('input').length).toBe(1)
    expect(group.querySelector<HTMLInputElement>('input')!.checked).toBe(false)
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

  it('puts every switch back off, and plays, when the tab is left', async () => {
    const { host, setOpen } = await render({
      patches: [{ id: 'a', title: 'Lamp lit', take: 2 }],
    })
    await click(switchFor(host, 'Dust'))
    await click(switchFor(host, 'Lamp lit'))
    await click(button(host, '❚❚ Pause'))
    await setOpen(false)
    await setOpen(true)
    expect(switchFor(host, 'Dust')!.checked).toBe(false)
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
