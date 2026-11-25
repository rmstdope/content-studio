import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Pager } = await import('./Pager')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

type Props = Parameters<typeof Pager>[0]
const middle: Props = {
  place: { position: 3, count: 12 },
  previous: { name: 'Harbour morning', href: '#/music/tracks/a' },
  next: { name: 'Market bustle', href: '#/music/tracks/c' },
}

function show(props: Props) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(createElement(Pager, props)))
  const [prev, next] = [...container.querySelectorAll<HTMLButtonElement>('button')]
  return {
    container,
    prev: prev!,
    next: next!,
    rerender: (p: Props) => act(() => root.render(createElement(Pager, p))),
    unmount: () => act(() => root.unmount()),
  }
}

const press = (key: string, target: Element = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

describe('the previous/next control', () => {
  it('says where the item stands and names the neighbours on hover', () => {
    const p = show(middle)
    expect(p.container.textContent).toBe('‹3 of 12›')
    expect(p.prev.title).toBe('Previous: Harbour morning (←)')
    expect(p.next.title).toBe('Next: Market bustle (→)')
    expect(p.prev.getAttribute('aria-label')).toBe('Previous: Harbour morning')
    expect(p.next.getAttribute('aria-label')).toBe('Next: Market bustle')
    p.unmount()
  })

  it('greys out an end, keeping it in place and focusable', () => {
    const first = show({ ...middle, place: { position: 1, count: 12 }, previous: null })
    expect(first.prev.getAttribute('aria-disabled')).toBe('true')
    expect(first.prev.dataset.why).toBe('This is the first. There is nothing before it.')
    expect(first.next.getAttribute('aria-disabled')).toBeNull()
    first.unmount()
    const last = show({ ...middle, place: { position: 12, count: 12 }, next: null })
    expect(last.next.getAttribute('aria-disabled')).toBe('true')
    expect(last.next.dataset.why).toBe('This is the last. There is nothing after it.')
    last.unmount()
    const only = show({ place: { position: 1, count: 1 }, previous: null, next: null })
    expect(only.container.textContent).toBe('‹1 of 1›')
    expect(only.prev.getAttribute('aria-disabled')).toBe('true')
    expect(only.next.getAttribute('aria-disabled')).toBe('true')
    only.unmount()
  })

  it('moves by the address, from a button or an arrow key, and not past an end', () => {
    window.location.hash = '#/start'
    const p = show({ ...middle, previous: null })
    act(() => p.prev.click())
    press('ArrowLeft')
    expect(window.location.hash).toBe('#/start')
    act(() => p.next.click())
    expect(window.location.hash).toBe('#/music/tracks/c')
    window.location.hash = '#/start'
    press('ArrowRight')
    expect(window.location.hash).toBe('#/music/tracks/c')
    p.unmount()
  })

  it('without keys, leaves the arrows alone and leaves the key out of the hover', () => {
    window.location.hash = '#/start'
    const p = show({ ...middle, keys: false })
    expect(p.prev.title).toBe('Previous: Harbour morning')
    expect(p.next.title).toBe('Next: Market bustle')
    press('ArrowRight')
    press('ArrowLeft')
    expect(window.location.hash).toBe('#/start')
    act(() => p.next.click())
    expect(window.location.hash).toBe('#/music/tracks/c')
    p.unmount()
  })

  it('leaves the arrows to the controls and dialogs that use them, and ignores a held key', () => {
    window.location.hash = '#/start'
    const p = show(middle)
    for (const markup of [
      '<ul class="scene-list"><li><a href="#x">a</a></li></ul>',
      '<div role="slider" tabindex="0"></div>',
      '<div role="tablist"><button role="tab">en</button></div>',
      '<div role="alertdialog"><button>Save</button></div>',
    ]) {
      const holder = document.createElement('div')
      holder.innerHTML = markup
      document.body.append(holder)
      press('ArrowRight', holder.querySelector('a, button, [role=slider]')!)
      expect(window.location.hash).toBe('#/start')
      holder.remove()
    }
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true }),
      )
    })
    expect(window.location.hash).toBe('#/start')
    p.unmount()
  })

  it('leaves the arrows to a field', () => {
    window.location.hash = '#/start'
    const p = show(middle)
    const field = document.createElement('input')
    document.body.append(field)
    press('ArrowRight', field)
    expect(window.location.hash).toBe('#/start')
    p.unmount()
    field.remove()
  })

  it('keeps focus on the pressed button on the next page, greyed out or not', () => {
    window.location.hash = '#/music/tracks/b'
    const p = show(middle)
    p.next.focus()
    act(() => p.next.click())
    p.unmount()
    // The next page opens at the address the press went to.
    const lastPage = show({
      place: { position: 4, count: 4 },
      previous: middle.previous,
      next: null,
    })
    expect(document.activeElement).toBe(lastPage.next)
    lastPage.unmount()
  })

  it('lands every move at the top of the page, from a button or an arrow key', () => {
    const tops: unknown[][] = []
    const real = window.scrollTo
    window.scrollTo = ((...args: unknown[]) => void tops.push(args)) as typeof window.scrollTo
    try {
      window.location.hash = '#/music/tracks/b'
      const p = show(middle)
      act(() => p.next.click())
      // The same control on the next item, as a page that is not opened afresh shows it.
      p.rerender({ ...middle, place: { position: 4, count: 12 } })
      expect(tops).toEqual([[0, 0]])
      press('ArrowLeft')
      p.rerender(middle)
      expect(tops).toEqual([
        [0, 0],
        [0, 0],
      ])
      // A page opened afresh by the step, as an image's page is.
      act(() => p.next.click())
      p.unmount()
      const fresh = show({ ...middle, place: { position: 4, count: 12 } })
      expect(tops.length).toBe(3)
      fresh.unmount()
    } finally {
      window.scrollTo = real
    }
  })

  it('lands at the top however long a leave question held the step', () => {
    const tops: unknown[][] = []
    const real = window.scrollTo
    const realNow = Date.now
    window.scrollTo = ((...args: unknown[]) => void tops.push(args)) as typeof window.scrollTo
    try {
      window.location.hash = '#/music/tracks/b'
      const p = show(middle)
      act(() => p.next.click())
      const later = realNow() + 60_000
      Date.now = () => later
      p.rerender({ ...middle, place: { position: 4, count: 12 } })
      expect(tops).toEqual([[0, 0]])
      p.unmount()
    } finally {
      window.scrollTo = real
      Date.now = realNow
    }
  })

  it('leaves the page where it is on a page opened another way', () => {
    const tops: unknown[][] = []
    const real = window.scrollTo
    window.scrollTo = ((...args: unknown[]) => void tops.push(args)) as typeof window.scrollTo
    try {
      window.location.hash = '#/elsewhere'
      const p = show(middle)
      p.rerender({ ...middle, place: { position: 4, count: 12 } })
      expect(tops).toEqual([])
      p.unmount()
    } finally {
      window.scrollTo = real
    }
  })

  const shift = (key: string, target: Element = document.body, repeat = false) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: true, repeat, bubbles: true }),
      )
    })

  /** A control that hears the arrows itself, as a take strip or a tab list does. */
  function control(markup: string) {
    const holder = document.createElement('div')
    holder.innerHTML = markup
    document.body.append(holder)
    const target = holder.querySelector('[data-target]')!
    const heard: string[] = []
    const listen = (event: Event) => heard.push((event as KeyboardEvent).key)
    target.addEventListener('keydown', listen)
    document.addEventListener('keydown', listen)
    return {
      target,
      heard,
      remove: () => {
        document.removeEventListener('keydown', listen)
        holder.remove()
      },
    }
  }

  const arrowUsers = [
    '<div data-strip><button data-target>take</button></div>',
    '<ul class="scene-list"><li><a data-target href="#x">a</a></li></ul>',
    '<span data-target role="slider" tabindex="0"></span>',
    '<div role="menu"><button data-target>Rename</button></div>',
    '<div role="tablist"><button data-target role="tab">en</button></div>',
    '<input data-target type="range">',
    '<button data-target>Play</button>',
  ]

  it('steps with Shift and the arrows from any control, which does not hear the press', () => {
    for (const keys of [true, false])
      for (const markup of arrowUsers) {
        const p = show({ ...middle, keys })
        const c = control(markup)
        window.location.hash = '#/start'
        shift('ArrowRight', c.target)
        expect(window.location.hash).toBe('#/music/tracks/c')
        shift('ArrowLeft', c.target)
        expect(window.location.hash).toBe('#/music/tracks/a')
        expect(c.heard).toEqual([])
        c.remove()
        p.unmount()
      }
  })

  it('does nothing with Shift past an end, and the control still does not hear it', () => {
    const p = show({ ...middle, next: null })
    const c = control(arrowUsers[0]!)
    window.location.hash = '#/start'
    shift('ArrowRight', c.target)
    expect(window.location.hash).toBe('#/start')
    expect(c.heard).toEqual([])
    c.remove()
    p.unmount()
  })

  it('steps once for a held Shift and arrow, keeping the repeats from the control', () => {
    const p = show(middle)
    const c = control(arrowUsers[0]!)
    window.location.hash = '#/start'
    shift('ArrowRight', c.target, true)
    expect(window.location.hash).toBe('#/start')
    expect(c.heard).toEqual([])
    c.remove()
    p.unmount()
  })

  it('leaves Shift with the arrows to a field, a dialog and a control that keeps them', () => {
    const p = show(middle)
    for (const markup of [
      '<input data-target type="text">',
      '<textarea data-target></textarea>',
      '<select data-target><option>a</option></select>',
      '<div role="alertdialog"><button data-target>Save</button></div>',
      '<span data-target role="slider" tabindex="0" data-keeps-shift-arrows></span>',
      '<button data-target data-keeps-shift-arrows>The lamp</button>',
    ]) {
      const c = control(markup)
      window.location.hash = '#/start'
      shift('ArrowRight', c.target)
      expect(window.location.hash).toBe('#/start')
      expect(c.heard).toEqual(['ArrowRight', 'ArrowRight'])
      c.remove()
    }
    p.unmount()
  })

  it('does not step with Shift under a modal window or in full screen', () => {
    const p = show(middle)
    window.location.hash = '#/start'
    const modal = document.createElement('div')
    modal.className = 'modal-back'
    document.body.append(modal)
    shift('ArrowRight')
    expect(window.location.hash).toBe('#/start')
    modal.remove()
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.body,
    })
    shift('ArrowRight')
    expect(window.location.hash).toBe('#/start')
    delete (document as unknown as Record<string, unknown>).fullscreenElement
    shift('ArrowRight')
    expect(window.location.hash).toBe('#/music/tracks/c')
    p.unmount()
  })

  it('after a Shift step, lands at the top with focus on that side’s arrow', () => {
    for (const [key, side] of [
      ['ArrowRight', 'next'],
      ['ArrowLeft', 'prev'],
    ] as const) {
      window.location.hash = '#/music/tracks/b'
      const p = show(middle)
      shift(key)
      p.unmount()
      const fresh = show({ ...middle, place: { position: 4, count: 12 } })
      expect(document.activeElement).toBe(fresh[side])
      fresh.unmount()
    }
  })

  it('does not move focus on a page opened another way', () => {
    window.location.hash = '#/elsewhere'
    const p = show(middle)
    expect(document.activeElement).toBe(document.body)
    p.unmount()
  })
})
