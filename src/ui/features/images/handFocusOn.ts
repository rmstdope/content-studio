/** Hands keyboard focus to `target` once the page has been drawn again: for a control that removes itself when pressed, so focus does not fall to the page body. */
export function handFocusOn(target: () => HTMLElement | null | undefined): void {
  setTimeout(() => target()?.focus(), 0)
}
