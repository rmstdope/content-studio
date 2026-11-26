/** Whether the computer the page runs on is a Mac (or an iPad with a keyboard), whose key is ⌘. */
function onMac(platform: string): boolean {
  return /^(Mac|iPad|iPhone|iPod)/.test(platform)
}

/** The key cap of the key that marks the whole picture: "⌘A", or "Ctrl+A" off a Mac. */
export function wholeKeyText(platform: string = navigator.platform): string {
  return onMac(platform) ? '⌘A' : 'Ctrl+A'
}

/** The same key as `aria-keyshortcuts` names it. */
export function wholeKeyAria(platform: string = navigator.platform): string {
  return onMac(platform) ? 'Meta+A' : 'Control+A'
}

/** Whether a key press is the one that marks the whole picture: ⌘A, or Ctrl+A off a Mac, alone. */
export function isWholeKey(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: string = navigator.platform,
): boolean {
  const mac = onMac(platform)
  return (
    event.key.toLowerCase() === 'a' &&
    event.metaKey === mac &&
    event.ctrlKey === !mac &&
    !event.altKey &&
    !event.shiftKey
  )
}
