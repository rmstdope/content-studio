/**
 * A press on `spot`, as far as focus goes: a browser moves focus to the nearest focusable ancestor
 * of what was pressed, and to the page's body when there is none. happy-dom does not, so this does
 * it by hand. Returns what has focus afterwards, where the next key arrives.
 */
export function pressBlank(spot: Element): Element {
  const focusable = spot.closest<HTMLElement>(
    '[tabindex], a[href], button, input, select, textarea',
  )
  if (focusable) focusable.focus()
  else (document.activeElement as HTMLElement | null)?.blur()
  return document.activeElement ?? document.body
}
