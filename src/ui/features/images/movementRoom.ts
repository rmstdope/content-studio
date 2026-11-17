/** The least height the Movement stage is fitted down to; a shorter window scrolls instead. */
export const MOVEMENT_MIN_ROOM = 240

/**
 * The height the window leaves for the Movement stage: its height less what sits above the stage
 * on the page (`top`) and what is kept below it (`below`: the caption and its gap), never under
 * {@link MOVEMENT_MIN_ROOM}.
 */
export function movementRoom(at: { windowHeight: number; top: number; below: number }): number {
  return Math.max(MOVEMENT_MIN_ROOM, Math.round(at.windowHeight - at.top - at.below))
}
