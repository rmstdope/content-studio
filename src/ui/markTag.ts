import type { PatchArea } from '../core/imagePatches'

/** How wide, in screen pixels, the tag beside a too-small mark can be. */
export const TAG_WIDTH = 250

/**
 * Which side of a mark its tag sits on: the right, unless the tag's width does not fit between the
 * mark and the picture's right edge, then the left. `stageWidth` is how wide the picture is on
 * the screen; the area and the picture are in the take's pixels.
 */
export function tagSide(
  area: PatchArea,
  picture: { width: number; height: number },
  stageWidth: number,
): 'right' | 'left' {
  const room = ((picture.width - area.x - area.width) / picture.width) * stageWidth
  return room >= TAG_WIDTH ? 'right' : 'left'
}
