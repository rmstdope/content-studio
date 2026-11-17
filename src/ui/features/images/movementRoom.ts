/** The least height the Movement stage is fitted down to; a shorter window scrolls instead. */
export const MOVEMENT_MIN_ROOM = 240

/**
 * The height the window leaves for the Movement stage: its height less what sits above the stage
 * on the page (`top`) and what is kept below it (`below`: the caption and its gap), never under
 * {@link MOVEMENT_MIN_ROOM}. When that leaves less than the least room and the image's tabs are on
 * the page (`tabs`, their top on the page), it is the room below the tabs instead, as when the
 * page is scrolled to them: a narrow window that stacks the sidebar above the page, or a short one,
 * still shows the picture as large as it can.
 */
export function movementRoom(at: {
  windowHeight: number
  top: number
  below: number
  tabs?: number
}): number {
  const fromTop = Math.round(at.windowHeight - at.top - at.below)
  if (fromTop >= MOVEMENT_MIN_ROOM || at.tabs === undefined) {
    return Math.max(MOVEMENT_MIN_ROOM, fromTop)
  }
  return Math.max(MOVEMENT_MIN_ROOM, Math.round(at.windowHeight - (at.top - at.tabs) - at.below))
}
