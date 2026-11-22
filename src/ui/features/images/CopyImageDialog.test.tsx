import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { CopyGroup, CopySource } from '../../../core/imageCopy'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { CopyImageDialog } = await import('./CopyImageDialog')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))
afterAll(() => GlobalRegistrator.unregister())

const src = (id: string, title: string, take: number, cropped = false): CopySource => ({
  id,
  title,
  take,
  size: '640 × 200',
  cropped,
})
const groups: CopyGroup[] = [
  { id: 'a1', title: 'Act One', images: [src('lantern', 'Lantern', 3), src('door', 'Door', 1)] },
  { id: 'a2', title: 'Act Two', images: [src('hall', 'Wide hall', 2, true)] },
]

async function open(list: CopyGroup[] = groups) {
  const copied: CopySource[] = []
  let closed = 0
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const heard: string[] = []
  const listen = (e: KeyboardEvent) => heard.push(e.key)
  document.addEventListener('keydown', listen)
  await act(async () => {
    root.render(
      createElement(CopyImageDialog, {
        title: 'Lit lantern',
        groups: list,
        onCopy: (s: CopySource) => copied.push(s),
        onClose: () => closed++,
      }),
    )
  })
  cleanups.push(() => {
    document.removeEventListener('keydown', listen)
    act(() => root.unmount())
    host.remove()
  })
  return { copied, closed: () => closed, heard }
}
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const all = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)]
const press = (el: Element, key: string, extra: KeyboardEventInit = {}) =>
  act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
    )
  })
const click = (el: Element) => act(async () => (el as HTMLElement).click())
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const copyButton = () =>
  all('.modal-actions button').find((b) => b.textContent === 'Copy as a take')!

describe('the copy window', () => {
  it('titles itself, focuses the search line and lists the images under their acts', async () => {
    await open()
    expect(q('h3')!.textContent).toBe('Copy another image into Lit lantern')
    expect(document.activeElement).toBe(q('input'))
    expect(q('input')!.getAttribute('placeholder')).toBe('Find an image…')
    expect(all('.label').map((l) => l.textContent)).toEqual(['Act One', 'Act Two'])
    const cells = all('[role="option"]')
    expect(cells.map((c) => c.textContent)).toEqual([
      'LanternTake 3 in the game',
      'DoorTake 1 in the game',
      'Wide hall640 × 200 · will be cropped to fit',
    ])
    expect(cells[0]!.querySelector('img')!.getAttribute('src')).toBe('/api/images/lantern/takes/3')
    expect(cells[0]!.getAttribute('title')).toBe('Lantern')
  })

  it('keeps Copy as a take off until a cell is picked, then names the source in the footer', async () => {
    const { copied } = await open()
    expect(copyButton().getAttribute('aria-disabled')).toBe('true')
    await click(copyButton())
    expect(copied).toEqual([])
    await click(all('[role="option"]')[0]!)
    expect(all('[role="option"]')[0]!.getAttribute('aria-selected')).toBe('true')
    expect(q('.copy-foot .muted')!.textContent).toBe(
      'Lantern · Take 3 — its picture only. Its patches and named areas stay with it.',
    )
    expect(copyButton().getAttribute('aria-disabled')).toBeNull()
    await click(copyButton())
    expect(copied.map((c) => c.id)).toEqual(['lantern'])
  })

  it('copies on a double click, and on Enter only for a picked cell', async () => {
    const { copied } = await open()
    const [lantern, door] = all('[role="option"]')
    await act(async () => {
      door!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(copied.map((c) => c.id)).toEqual(['door'])
    lantern!.focus()
    await press(lantern!, 'Enter')
    expect(copied).toHaveLength(1)
    expect(lantern!.getAttribute('aria-selected')).toBe('true')
    await press(lantern!, 'Enter')
    expect(copied.map((c) => c.id)).toEqual(['door', 'lantern'])
  })

  it('narrows by title whatever the case, drops an act with no match, and says when nothing matches', async () => {
    await open()
    await type(q('input') as HTMLInputElement, 'HALL')
    expect(all('.label').map((l) => l.textContent)).toEqual(['Act Two'])
    await type(q('input') as HTMLInputElement, 'cat')
    expect(all('[role="option"]')).toEqual([])
    expect(q('.modal-note')!.textContent).toBe('No image matches “cat”.')
  })

  it('says so when no other image has a picture, with Copy as a take off', async () => {
    await open([])
    expect(q('.modal-note')!.textContent).toBe(
      'No other image in the game has a picture yet. Choose a take on another image first.',
    )
    expect(copyButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('moves between cells with the arrows, from the search line down and back', async () => {
    await open()
    await press(q('input')!, 'ArrowDown')
    const cells = all('[role="option"]')
    expect(document.activeElement).toBe(cells[0]!)
    await press(cells[0]!, 'ArrowRight')
    expect(document.activeElement).toBe(cells[1]!)
    await press(cells[1]!, 'ArrowUp')
    expect(document.activeElement).toBe(cells[0]!)
    await press(cells[0]!, 'ArrowUp')
    expect(document.activeElement).toBe(q('input'))
  })

  it('closes on Esc, Cancel, ✕ and the backdrop, without copying, and keeps the page’s keys to itself', async () => {
    const { copied, closed, heard } = await open()
    await press(q('input')!, 'Escape')
    await click(all('button').find((b) => b.textContent === 'Cancel')!)
    await click(all('button').find((b) => b.textContent === '✕')!)
    await act(async () => {
      q('.modal-back')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(closed()).toBe(4)
    expect(copied).toEqual([])
    await press(q('input')!, 'c')
    await press(q('input')!, '2')
    await press(q('input')!, 'ArrowRight')
    expect(heard).toEqual([])
  })

  it('has one tab stop in the grid: the pick, else the first image shown', async () => {
    await open()
    const stops = () => all('[role="option"]').map((c) => c.getAttribute('tabindex'))
    expect(stops()).toEqual(['0', '-1', '-1'])
    await click(all('[role="option"]')[1]!)
    expect(stops()).toEqual(['-1', '0', '-1'])
    await type(q('input') as HTMLInputElement, 'hall')
    expect(stops()).toEqual(['0'])
  })

  it('wraps Tab inside the window', async () => {
    await open()
    const last = all('.modal-actions button').at(-1)!
    last.focus()
    await press(last, 'Tab')
    expect(document.activeElement).toBe(all('input, button')[0]!)
  })
})
