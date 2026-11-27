/**
 * A press on `spot`, as far as focus goes: a browser moves focus to the nearest focusable ancestor
 * of what was pressed, and to the page's body when there is none. happy-dom does not, so this does
 * it by hand. Returns what has focus afterwards, where the next key arrives. Its list is what a
 * press focuses, not what Tab stops at (`containerKeys`): a `tabindex="-1"` element is in it.
 */
export function pressBlank(spot: Element): Element {
  const focusable = spot.closest<HTMLElement>(
    '[tabindex], a[href], button, input, select, textarea',
  )
  if (focusable) focusable.focus()
  else (document.activeElement as HTMLElement | null)?.blur()
  return document.activeElement ?? document.body
}

/** A press on `spot` (see {@link pressBlank}) and then Esc, as a keyboard sends it. */
export function pressBlankThenEscape(spot: Element): void {
  pressBlank(spot).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
}
