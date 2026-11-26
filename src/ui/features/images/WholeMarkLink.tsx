import { wholeKeyAria, wholeKeyText } from '../../wholeMark'

/**
 * The link that marks the whole picture, with its key's cap after it, as part of the line under the
 * words on Fine-tune and Patches. `after` is the punctuation that keeps to the cap's side.
 */
export function WholeMarkLink({
  label,
  after,
  onPress,
}: {
  label: string
  after?: string
  onPress: () => void
}) {
  return (
    <span className="mark-whole">
      <button
        type="button"
        className="patch-back"
        data-mark-whole=""
        aria-keyshortcuts={wholeKeyAria()}
        onClick={onPress}
      >
        {label}
      </button>{' '}
      <kbd>{wholeKeyText()}</kbd>
      {after}
    </span>
  )
}

/** Whether focus is on a link of this kind, which is about to go once the whole picture is marked. */
export function onWholeMarkLink(): boolean {
  return document.activeElement?.hasAttribute('data-mark-whole') ?? false
}
