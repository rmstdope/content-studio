import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { PatchArea } from '../../../core/imagePatches'
import type { PatchSpace } from '../../patchGameSpace'
import type { WorkbenchMark } from './useWorkbenchMark'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
// The key follows the computer: these tests are a Mac's.
Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' })
const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useWorkbenchMark } = await import('./useWorkbenchMark')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => GlobalRegistrator.unregister())

const take = { width: 1000, height: 500 }

/** Mounts a bench that keeps its own mark, on a stage as large on screen as the picture drawn. */
async function mount(over: { shown?: PatchSpace; covered?: boolean } = {}) {
  const seen = { marks: [] as PatchArea[], gone: 0, bench: null as WorkbenchMark | null }
  const Bench = () => {
    const [mark, setMark] = useState<PatchArea | null>(null)
    const bench = useWorkbenchMark()({
      take,
      mark,
      onMark: (area) => {
        seen.marks.push(area)
        setMark(area)
      },
      onLinkGone: () => seen.gone++,
      ...over,
    })
    seen.bench = bench
    return createElement('div', { className: 'patch-stage', ...bench.stage }, bench.drawn)
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(Bench)))
  cleanups.push(() => {
    act(() => root.unmount())
    host.remove()
  })
  const stage = host.querySelector<HTMLElement>('.patch-stage')!
  const size = over.shown ?? take
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: size.width, height: size.height }) as DOMRect
  stage.setPointerCapture = () => {}
  const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
    act(async () => {
      stage.dispatchEvent(
        new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }),
      )
    })
  const drag = async (from: [number, number], to: [number, number]) => {
    await pointer('pointerdown', ...from)
    await pointer('pointermove', ...to)
    await pointer('pointerup', ...to)
  }
  const box = () => host.querySelector<HTMLElement>('.patch-mark')
  const said = () => host.querySelector('.sr-only[aria-live="polite"]')!.textContent
  return { host, seen, pointer, drag, box, said }
}

const SMALL = 'Too small: 36 × 30. Make it at least 50 × 50, or the model may change nothing.'

describe('useWorkbenchMark', () => {
  it('marks what is dragged and draws it where it lies', async () => {
    const { seen, drag, box, said, host } = await mount()
    expect(box()).toBeNull()
    await drag([100, 50], [300, 250])
    expect(seen.marks.at(-1)).toEqual({ x: 100, y: 50, width: 200, height: 200 })
    expect([box()!.style.left, box()!.style.top, box()!.style.width, box()!.style.height]).toEqual([
      '10%',
      '10%',
      '20%',
      '40%',
    ])
    expect(box()!.className).toBe('patch-mark')
    expect(host.querySelector('.mark-tag')).toBeNull()
    expect(said()).toBe('')
  })

  it('warns about a small mark as it is dragged, and says so when the drag ends', async () => {
    const { pointer, box, said, host } = await mount()
    await pointer('pointerdown', 100, 100)
    await pointer('pointermove', 136, 130)
    expect(box()!.className).toBe('patch-mark patch-mark-small')
    expect(host.querySelector('.mark-tag')).not.toBeNull()
    expect(said()).toBe('')
    await pointer('pointerup', 136, 130)
    expect(said()).toBe(SMALL)
    // The next drag starts quiet.
    await pointer('pointerdown', 100, 100)
    expect(said()).toBe('')
  })

  it('changes nothing on a click, a second button, a Control press or a cancelled drag', async () => {
    const { seen, pointer, drag } = await mount()
    await drag([100, 100], [100, 100])
    await pointer('pointerdown', 100, 100, { button: 2 })
    await pointer('pointermove', 300, 300)
    await pointer('pointerdown', 100, 100, { ctrlKey: true })
    await pointer('pointermove', 300, 300)
    expect(seen.marks).toEqual([])
    await pointer('pointerdown', 100, 100)
    await pointer('pointercancel', 100, 100)
    await pointer('pointermove', 300, 300)
    expect(seen.marks).toEqual([])
  })

  it('marks the whole picture, unannounced and unwarned', async () => {
    const { seen, drag, box, said } = await mount()
    await drag([100, 100], [136, 130])
    await act(async () => seen.bench!.markWhole())
    expect(seen.marks.at(-1)).toEqual({ x: 0, y: 0, ...take })
    expect(seen.bench!.whole).toBe(true)
    expect(box()!.className).toBe('patch-mark')
    expect(said()).toBe('')
    expect(seen.gone).toBe(0)
  })

  it('moves focus on only when the link that goes away was pressed or focused', async () => {
    const { seen } = await mount()
    await act(async () => seen.bench!.markWhole(true))
    expect(seen.gone).toBe(1)
    const link = document.createElement('button')
    link.setAttribute('data-mark-whole', '')
    document.body.append(link)
    link.focus()
    await act(async () => seen.bench!.markWhole())
    expect(seen.gone).toBe(2)
    link.remove()
  })

  it('takes ⌘A for the whole picture, but leaves it to a field text is typed into', async () => {
    const { seen } = await mount()
    const press = async (target: HTMLElement, key: string) => {
      const event = new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true })
      target.dispatchEvent(event)
      let taken = false
      await act(async () => {
        taken = seen.bench!.wholeKey(event)
      })
      return [taken, event.defaultPrevented]
    }
    const words = document.createElement('textarea')
    document.body.append(words)
    expect(await press(words, 'a')).toEqual([false, false])
    expect(await press(document.body, 'b')).toEqual([false, false])
    expect(seen.marks).toEqual([])
    expect(await press(document.body, 'a')).toEqual([true, true])
    expect(seen.marks).toEqual([{ x: 0, y: 0, ...take }])
    words.remove()
  })

  it('drags and draws in the space shown, marking in the picture’s own pixels', async () => {
    // Half the size, with 100 of the picture cropped off at the left.
    const shown: PatchSpace = {
      width: 400,
      height: 250,
      place: (a) => ({ x: (a.x - 100) / 2, y: a.y / 2, width: a.width / 2, height: a.height / 2 }),
      unplace: (a) => ({ x: a.x * 2 + 100, y: a.y * 2, width: a.width * 2, height: a.height * 2 }),
    }
    const { seen, drag, box } = await mount({ shown })
    await drag([100, 50], [200, 150])
    expect(seen.marks.at(-1)).toEqual({ x: 300, y: 100, width: 200, height: 200 })
    expect([box()!.style.left, box()!.style.width]).toEqual(['25%', '25%'])
    // The whole picture reaches past what is shown, and is drawn up to its edges.
    await act(async () => seen.bench!.markWhole())
    expect([box()!.style.left, box()!.style.width]).toEqual(['0%', '100%'])
  })

  it('draws no box or tag while covered, and still says a small drag', async () => {
    const { drag, box, said, host } = await mount({ covered: true })
    await drag([100, 100], [136, 130])
    expect(box()).toBeNull()
    expect(host.querySelector('.mark-tag')).toBeNull()
    expect(said()).toBe(SMALL)
  })
})
