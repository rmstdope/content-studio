import type { KeyboardEvent, MouseEvent } from 'react'

/** What Tab stops at inside a window. */
const TAB_STOPS = ['a[href]', 'button', 'input', 'select', 'textarea', '[tabindex]']
  .map((stop) => `${stop}:not([tabindex="-1"], :disabled)`)
  .join(', ')

/** Wraps Tab and Shift+Tab at the edges of a modal, so the keyboard never leaves it for the page. */
function wrapTab(event: KeyboardEvent<HTMLElement>) {
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(TAB_STOPS)]
  const target = event.target as HTMLElement
  const [from, to] = event.shiftKey ? [stops[0], stops.at(-1)] : [stops.at(-1), stops[0]]
  if (stops.includes(target) && target !== from) return
  event.preventDefault()
  to?.focus()
}

/**
 * The props that make a window, menu or inline question hear its keys; every one of them takes its
 * Esc from here. Spread them on its container. `tabIndex` makes a press on a spot that is not a
 * control focus the container rather than the page, so its keys (Esc above all) still reach
 * `onKeyDown`; where focus must rest on an element inside (a menu's list), put `tabIndex` there
 * and `onKeyDown` on the outer one.
 *
 * `onEscape`: what Esc closes; the key then goes no further. Leave it out while there is nothing
 * to close, and Esc passes on. `modal`: Tab and Shift+Tab stay inside the container.
 * `onKeyDown`: the container's other keys; it hears every key, before the two above.
 */
export function containerKeys({
  onEscape,
  modal = false,
  onKeyDown,
}: {
  onEscape?: () => void
  modal?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
}) {
  return {
    tabIndex: -1,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      onKeyDown?.(event)
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault()
        event.stopPropagation()
        onEscape()
      } else if (event.key === 'Tab' && modal) wrapTab(event)
    },
  }
}

/**
 * The `onMouseDown` of a modal's backdrop: a press on the backdrop itself leaves focus where it
 * is (the browser would move it to the page, where the window's keys are not heard, or take it
 * back from what `onPress` just focused). `onPress` is what such a press does, if anything.
 */
export function keepFocusOnBackdrop(onPress?: () => void) {
  return (event: MouseEvent) => {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    onPress?.()
  }
}
