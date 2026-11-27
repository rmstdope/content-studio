import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement: h } = await import('react')
const { createRoot } = await import('react-dom/client')
const { containerKeys, keepFocusOnBackdrop } = await import('./containerKeys')
const { pressBlank } = await import('../../../test/pressBlank')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())
afterEach(() => (document.body.innerHTML = ''))

type Options = Parameters<typeof containerKeys>[0]

/** A box with a title and three controls inside an outer element that counts the keys it hears. */
function show(options: Options) {
  const outside: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  act(() =>
    createRoot(container).render(
      h(
        'div',
        { onKeyDown: (e: { key: string }) => outside.push(e.key) },
        h(
          'section',
          containerKeys(options),
          h('h2', null, 'Title'),
          h('input'),
          h('button', { type: 'button', className: 'middle' }, 'Middle'),
          h('button', { type: 'button', tabIndex: -1 }, 'Skipped'),
          h('button', { type: 'button', className: 'last' }, 'Last'),
          h('button', { type: 'button', tabIndex: -1 }, 'Skipped too'),
        ),
      ),
    ),
  )
  const q = <E extends HTMLElement>(selector: string) => container.querySelector<E>(selector)!
  const key = (on: Element, name: string, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      on.dispatchEvent(event)
    })
    return event
  }
  return { outside, q, key }
}

describe('containerKeys', () => {
  it('hears Escape after a press on a spot that is not a control, and keeps it', () => {
    let closed = 0
    const box = show({ onEscape: () => closed++ })
    const event = box.key(pressBlank(box.q('h2')), 'Escape')
    expect(closed).toBe(1)
    expect(event.defaultPrevented).toBe(true)
    expect(box.outside).toEqual([])
  })

  it('passes Escape on while it has nothing to close', () => {
    const box = show({})
    const event = box.key(box.q('input'), 'Escape')
    expect(event.defaultPrevented).toBe(false)
    expect(box.outside).toEqual(['Escape'])
  })

  it('hands every key to the caller, before its own', () => {
    const heard: string[] = []
    const box = show({
      modal: true,
      onEscape: () => heard.push('closed'),
      onKeyDown: (e) => heard.push(e.key),
    })
    box.key(box.q('input'), 'ArrowDown')
    box.key(box.q('input'), 'Escape')
    box.key(box.q('.last'), 'Tab')
    expect(heard).toEqual(['ArrowDown', 'Escape', 'closed', 'Tab'])
  })

  it('wraps Tab at the edges of a modal, past what Tab does not stop at', () => {
    const box = show({ modal: true })
    box.q('.last').focus()
    expect(box.key(box.q('.last'), 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(box.q('input'))
    expect(box.key(box.q('input'), 'Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(box.q('.last'))
  })

  it('wraps past a disabled control, which Tab does not stop at', () => {
    const box = show({ modal: true })
    box.q<HTMLButtonElement>('.last').disabled = true
    box.q('.middle').focus()
    expect(box.key(box.q('.middle'), 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(box.q('input'))
  })

  it('leaves Tab between the edges to the browser', () => {
    const box = show({ modal: true })
    box.q('.middle').focus()
    expect(box.key(box.q('.middle'), 'Tab').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(box.q('.middle'))
  })

  it('takes Tab from the modal itself to its first control, and Shift+Tab to its last', () => {
    const box = show({ modal: true })
    box.key(pressBlank(box.q('h2')), 'Tab')
    expect(document.activeElement).toBe(box.q('input'))
    box.key(pressBlank(box.q('h2')), 'Tab', true)
    expect(document.activeElement).toBe(box.q('.last'))
  })

  it('leaves Tab alone outside a modal', () => {
    const box = show({ onEscape: () => {} })
    box.q('.last').focus()
    expect(box.key(box.q('.last'), 'Tab').defaultPrevented).toBe(false)
  })
})

describe('keepFocusOnBackdrop', () => {
  /** A backdrop with a window on it. */
  function show(onPress?: () => void) {
    const container = document.createElement('div')
    document.body.append(container)
    act(() =>
      createRoot(container).render(
        h('div', { className: 'back', onMouseDown: keepFocusOnBackdrop(onPress) }, h('p')),
      ),
    )
    return (selector: string) => {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      act(() => {
        container.querySelector(selector)!.dispatchEvent(down)
      })
      return down
    }
  }

  it('keeps focus where it is on a press on the backdrop, and says it was pressed', () => {
    let pressed = 0
    const press = show(() => pressed++)
    expect(press('.back').defaultPrevented).toBe(true)
    expect(pressed).toBe(1)
  })

  it('leaves a press inside the window to the browser', () => {
    let pressed = 0
    const press = show(() => pressed++)
    expect(press('p').defaultPrevented).toBe(false)
    expect(pressed).toBe(0)
  })
})
