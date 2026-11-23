import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Menu } = await import('./Menu')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

function show() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(Menu, {
        label: 'How it plays',
        face: 'Once',
        options: [
          { value: 'once', label: 'Once' },
          { value: 'loop', label: 'Loop' },
        ],
        value: 'once',
        onChange: () => {},
      }),
    ),
  )
  return {
    button: container.querySelector<HTMLButtonElement>('.menu-button')!,
    list: () => container.querySelector<HTMLElement>('.menu-list'),
  }
}

describe('Menu', () => {
  it('closes on Escape after a press on a spot inside the list that is not a control', () => {
    const menu = show()
    act(() => menu.button.click())
    // A browser moves focus on a press to the nearest focusable ancestor of what was pressed,
    // and to the page's body when there is none; happy-dom does not, so this does it by hand.
    const focusable = menu.list()!.closest<HTMLElement>('[tabindex], button, input')
    if (focusable) focusable.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
    act(() => {
      ;(document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(menu.list()).toBeNull()
    expect(document.activeElement).toBe(menu.button)
  })
})
