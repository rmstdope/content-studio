import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { EffectRow } from '../../../core/effects'
import type { EffectTakesView, EffectTakeView } from '../../../core/effectTakes'
import { installFakeWebAudio } from '../../../../test/fakeWebAudio'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { EffectTakesPanel } = await import('./EffectTakesPanel')
const { LEVEL_SAVE_DELAY_MS } = await import('./EffectLevel')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const isOff = (element: Element) => element.getAttribute('aria-disabled') === 'true'
const realFetch = globalThis.fetch
const cleanups: (() => void)[] = []
afterEach(() => {
  globalThis.fetch = realFetch
  cleanups.splice(0).forEach((c) => c())
})
afterAll(() => GlobalRegistrator.unregister())

const take = (n: number, over: Partial<EffectTakeView> = {}): EffectTakeView => ({
  n,
  file: `0123456789abcdef.${n}.wav`,
  seconds: 1.4,
  peaks: [0.2, 0.8, 0.5],
  chosen: false,
  model: 'Stable Audio 3 Small SFX',
  loops: false,
  quietAt: null,
  level: 1,
  ...over,
})
const view = (over: Partial<EffectTakesView> = {}): EffectTakesView => ({
  ok: true,
  canMake: true,
  projectModel: 'small-sfx',
  uv: true,
  models: [
    { id: 'small-sfx', download: 'whole', failed: false },
    { id: 'open-1', download: 'whole', failed: false },
  ],
  takes: [],
  making: [],
  failed: [],
  lockUnread: false,
  ...over,
})
const row = (over: Partial<EffectRow> = {}): EffectRow => ({
  id: 'chest-open',
  name: 'Chest open',
  description: 'a chest opens',
  gameDescription: 'a chest opens',
  seconds: 2,
  loops: false,
  changedHere: false,
  gameChanged: false,
  status: 'not-chosen',
  current: { kind: 'nothing' },
  changed: [],
  chosen: false,
  ...over,
})
const chosenRow = () =>
  row({
    status: 'chosen',
    chosen: true,
    current: { kind: 'take', take: 2, exists: true },
  })

type Call = { url: string; method: string; body: string | null }

function render(
  effect: EffectRow,
  data: EffectTakesView,
  answer: (call: Call) => Response | Promise<Response> = () => Response.json({ ok: true }),
) {
  const calls: Call[] = []
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const call = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: (init?.body as string) ?? null,
    }
    calls.push(call)
    return Promise.resolve(answer(call))
  }) as typeof fetch
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  client.setQueryData(['effect-takes', effect.id], data)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const draw = (shown: EffectRow) =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(EffectTakesPanel, { row: shown }),
      ),
    )
  act(() => draw(effect))
  const text = () => container.textContent!.replace(/\s+/g, ' ')
  const slider = (n: number) =>
    container.querySelector<HTMLInputElement>(`input[aria-label="Level of take ${n}"]`)
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent!.trim() === label)
  /** Moves a slider as a drag or an arrow key does. */
  const move = (n: number, percent: number) =>
    act(async () => {
      const input = slider(n)!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        String(percent),
      )
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  const release = (n: number) =>
    act(async () => {
      slider(n)!.dispatchEvent(new window.Event('pointerup', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 5))
    })
  const settle = (ms = 10) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))
  const levelCalls = () => calls.filter((c) => c.url.endsWith('/level'))
  return { container, calls, text, slider, button, move, release, settle, levelCalls }
}

const card = (n: number, over: Partial<EffectTakeView> = {}) => take(n, over)

describe('the level slider', () => {
  const data = view({
    takes: [card(1), card(2, { chosen: true, level: 1.4 }), card(3, { level: 0.6 })],
  })

  it('shows on every card and on the chosen take, from 10% to 200% in steps of 5%, with its value', () => {
    const { slider, container } = render(chosenRow(), data)
    for (const n of [1, 2, 3]) {
      const input = slider(n)!
      expect([input.min, input.max, input.step]).toEqual(['10', '200', '5'])
    }
    expect(slider(1)!.value).toBe('100')
    expect(slider(3)!.value).toBe('60')
    expect(container.querySelector('.in-game-level, .track-in-game .effect-level')).not.toBeNull()
    expect(container.textContent).toContain('Level')
    expect(container.textContent).toContain('140%')
    expect(container.textContent).toContain('60%')
  })

  it('shows Back to 100% only on a take that is not at 100%', () => {
    const { button, container } = render(chosenRow(), data)
    expect(container.querySelectorAll('button.level-reset')).toHaveLength(2)
    expect(button('Back to 100%')).toBeDefined()
    const none = render(row(), view({ takes: [card(1)] }))
    expect(none.button('Back to 100%')).toBeUndefined()
  })

  it('says what the game plays on the chosen take only, when it is not at 100%', () => {
    const { text } = render(chosenRow(), data)
    expect(text()).toContain('The game plays it at 140%.')
    expect(text()).not.toContain('The game plays it at 60%.')
    const at100 = render(chosenRow(), view({ takes: [card(2, { chosen: true })] }))
    expect(at100.text()).not.toContain('The game plays it at')
  })

  it('shows the value while dragging and saves nothing until the mouse is let go', async () => {
    const { move, release, text, slider, levelCalls } = render(row(), view({ takes: [card(1)] }))
    await move(1, 140)
    expect(text()).toContain('140%')
    expect(slider(1)!.value).toBe('140')
    expect(levelCalls()).toHaveLength(0)
    await release(1)
    expect(levelCalls()).toHaveLength(1)
    expect(levelCalls()[0]).toMatchObject({
      url: '/api/effects/chest-open/takes/0123456789abcdef.1.wav/level',
      method: 'PUT',
    })
    expect(JSON.parse(levelCalls()[0]!.body!)).toEqual({ level: 1.4 })
  })

  it('saves half a second after the last arrow key press', async () => {
    const { move, settle, levelCalls } = render(row(), view({ takes: [card(1)] }))
    await move(1, 105)
    await move(1, 110)
    await settle(LEVEL_SAVE_DELAY_MS - 200)
    expect(levelCalls()).toHaveLength(0)
    await settle(300)
    expect(levelCalls()).toHaveLength(1)
    expect(JSON.parse(levelCalls()[0]!.body!)).toEqual({ level: 1.1 })
  })

  it('goes back to 100% and saves at once with Back to 100%', async () => {
    const { button, levelCalls, settle, slider } = render(
      row(),
      view({ takes: [card(1, { level: 1.6 })] }),
    )
    await act(async () => button('Back to 100%')!.click())
    await settle()
    expect(JSON.parse(levelCalls()[0]!.body!)).toEqual({ level: 1 })
    expect(slider(1)!.value).toBe('100')
  })

  it('says it is writing the game’s sound while the chosen take’s level saves', async () => {
    let finish: (r: Response) => void = () => {}
    const { move, release, text } = render(
      chosenRow(),
      view({ takes: [card(2, { chosen: true })] }),
      (call) =>
        call.url.endsWith('/level')
          ? new Promise<Response>((r) => (finish = r))
          : Response.json({ ok: true }),
    )
    await move(2, 140)
    await release(2)
    expect(text()).toContain('Writing it into the game at 140%…')
    await act(async () => finish(Response.json({ ok: true })))
  })

  it('puts the slider back and says why when the game’s sound could not be written', async () => {
    const { move, release, text, slider } = render(
      chosenRow(),
      view({ takes: [card(2, { chosen: true, level: 1.2 })] }),
      (call) =>
        call.url.endsWith('/level')
          ? Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 })
          : Response.json({ ok: true }),
    )
    await move(2, 150)
    await release(2)
    expect(slider(2)!.value).toBe('120')
    expect(text()).toContain(
      'The level of Take 2 could not be changed: The disk is full. The game still plays it at 120%.',
    )
  })

  it('puts the slider back and says why when a take not in the game could not be saved', async () => {
    const { move, release, text, slider } = render(
      row(),
      view({ takes: [card(3, { level: 0.6 })] }),
      (call) =>
        call.url.endsWith('/level')
          ? Response.json({ ok: false, message: 'The disk is full.' }, { status: 409 })
          : Response.json({ ok: true }),
    )
    await move(3, 150)
    await release(3)
    expect(slider(3)!.value).toBe('60')
    expect(text()).toContain('The level of Take 3 could not be saved: The disk is full.')
  })

  it('warns when the level makes the loudest parts go past the top, and only above 100%', async () => {
    const { move, text, container } = render(row(), view({ takes: [card(1)] }))
    await move(1, 125)
    expect(text()).not.toContain('cut flat')
    await move(1, 180)
    expect(text()).toContain(
      'At 180% the loudest parts are cut flat and may sound harsh. Up to 125% stays clean.',
    )
    // The bars past the top (0.8 × 1.8) are red; the others are not.
    expect(container.querySelectorAll('.wave i.over')).toHaveLength(1)
    await move(1, 60)
    expect(text()).not.toContain('cut flat')
    expect(container.querySelectorAll('.wave i.over')).toHaveLength(0)
  })

  it('says up to 100% when even 100% reaches the top', async () => {
    const { move, text } = render(row(), view({ takes: [card(1, { peaks: [1, 0.3] })] }))
    await move(1, 150)
    expect(text()).toContain('Up to 100% stays clean.')
  })

  it('greys the slider and Back to 100% while the lock cannot be read, with the reason', async () => {
    const { slider, button, move, levelCalls, release, text } = render(
      row(),
      view({ lockUnread: true, takes: [card(1, { level: 1.5 })] }),
    )
    const why =
      'The sound effects lock cannot be read. Choosing, dropping, fading and levels wait until it can be.'
    expect(isOff(slider(1)!)).toBe(true)
    expect(slider(1)!.getAttribute('data-why')).toBe(why)
    expect(isOff(button('Back to 100%')!)).toBe(true)
    expect(button('Choose')!.getAttribute('data-why')).toBe(why)
    expect(text()).toContain(
      'Choosing, dropping, fading and setting levels wait until the sound effects lock can be read. You can still listen and make more takes.',
    )
    await move(1, 100)
    await release(1)
    expect(levelCalls()).toHaveLength(0)
  })

  it('plays a take at its level, and a change while it plays is heard at once', async () => {
    cleanups.push(installFakeWebAudio())
    const elements: { volume: number }[] = []
    const Fake = globalThis.Audio
    globalThis.Audio = class extends Fake {
      constructor() {
        super()
        elements.push(this)
      }
    }
    const { container, move, settle } = render(row(), view({ takes: [card(1, { level: 0.5 })] }))
    await act(async () => container.querySelector<HTMLButtonElement>('.takes .play')!.click())
    await settle()
    expect(elements.at(-1)!.volume).toBe(0.5)
    await move(1, 30)
    expect(elements.at(-1)!.volume).toBeCloseTo(0.3)
  })

  it('grows and shrinks the waveform’s bars with the level', async () => {
    const { container, move } = render(row(), view({ takes: [card(1)] }))
    const heights = () =>
      [...container.querySelectorAll<HTMLElement>('.takes .wave i')].map((i) => i.style.height)
    expect(heights()).toEqual(['20%', '80%', '50%'])
    await move(1, 50)
    expect(heights()).toEqual(['10%', '40%', '25%'])
  })

  it('hides a take’s slider while its Fades… editor is open', async () => {
    const { button, slider, settle } = render(row(), view({ takes: [card(1)] }))
    expect(slider(1)).not.toBeNull()
    await act(async () => button('Fades…')!.click())
    await settle()
    expect(slider(1)).toBeNull()
  })
})
