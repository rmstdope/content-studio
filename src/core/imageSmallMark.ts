import { isWholeArea, type PatchArea } from './imagePatches'
import type { Pixels } from './imagePixels'

/** Each side of a mark, in the take's pixels, below which the edit model may change nothing. */
export const MARK_SMALLEST = 50

/** The pixels at or above this opacity that a take keeps, below which it counts as a few specks. */
export const NEAR_EMPTY_PIXELS = 300

/** How solid a kept pixel is to count towards `NEAR_EMPTY_PIXELS`: the soft edge does not. */
const SOLID = 128

/**
 * The size of a mark under `MARK_SMALLEST` on either side, in the take's pixels; null for no mark,
 * a big enough one, or one over the whole of `picture` (there is no bigger mark to make).
 */
export function smallMark(
  area: PatchArea | null,
  picture?: { width: number; height: number },
): { width: number; height: number } | null {
  if (!area || (area.width >= MARK_SMALLEST && area.height >= MARK_SMALLEST)) return null
  if (picture && isWholeArea(area, picture)) return null
  return { width: area.width, height: area.height }
}

/** The first sentence of the warning about a small mark. */
export function smallMarkHead(size: { width: number; height: number }): string {
  return `Too small: ${size.width} × ${size.height}.`
}

/** What to do about a small mark: the second sentence of the warning. */
export const SMALL_MARK_ADVICE = `Make it at least ${MARK_SMALLEST} × ${MARK_SMALLEST}, or the model may change nothing.`

/** The whole warning about a small mark, as one plain sentence pair (what an agent is told). */
export function smallMarkText(size: { width: number; height: number }): string {
  return `${smallMarkHead(size)} ${SMALL_MARK_ADVICE}`
}

/** How little a ready take changed: nothing, or only a few specks. */
export type TakeChange = 'nothing' | 'little'

/** The badge of a take that changed little or nothing. */
export const CHANGE_BADGE: Record<TakeChange, string> = {
  nothing: 'Changed nothing',
  little: 'Changed very little',
}

/** The line explaining the badge, on the take's row. */
export const CHANGE_LINE: Record<TakeChange, string> = {
  nothing: 'The model left the marked area as it was. Try a bigger mark.',
  little: 'The model changed only a few specks. Try a bigger mark.',
}

/**
 * Whether a take made with a mark (transparent where it keeps nothing) changed nothing, changed
 * only a few specks, or changed something worth looking at (null).
 */
export function changeOf(pixels: Pixels): TakeChange | null {
  let seen = false
  let solid = 0
  for (let i = 3; i < pixels.data.length; i += 4) {
    const alpha = pixels.data[i]!
    if (alpha > 0) seen = true
    if (alpha >= SOLID) solid++
  }
  if (!seen) return 'nothing'
  return solid < NEAR_EMPTY_PIXELS ? 'little' : null
}
