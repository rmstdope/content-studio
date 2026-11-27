import { chosenOf, type Chosen } from '../src/core/lockRead'

/** A take of a UI test's fixture, marked when it is the one chosen. */
export type Marked<T> = T & { chosen?: boolean }

/** What a fixture's view says is chosen: its marked take, none, or not known while unread. */
export function chosenAmong(
  takes: readonly { n: number; chosen?: boolean }[],
  unread = false,
): Chosen {
  return chosenOf(!unread, takes.find((take) => take.chosen)?.n ?? null)
}
