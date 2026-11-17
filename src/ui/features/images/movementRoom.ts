/** The least height the Movement stage is fitted down to; a shorter window scrolls instead. */
export const MOVEMENT_MIN_ROOM = 240

/** The most the room below the image's tabs gives the stage: past it, the stage fits below where it starts. */
export const MOVEMENT_TABS_ROOM = 480

/**
 * The height the window leaves for the Movement stage: its height less what sits above the stage
 * on the page (`top`) and what is kept below it (`below`: the caption and its gap), never under
 * {@link MOVEMENT_MIN_ROOM}. When the image's tabs are on the page (`tabs`, their top on the page),
 * it is at least the room below them, as when the page is scrolled to them, up to
 * {@link MOVEMENT_TABS_ROOM}: a narrow window that stacks the sidebar above the page, or a short
 * one, still shows the picture large, and the stage never shrinks as the window grows.
 */
export function movementRoom(at: {
  windowHeight: number
  top: number
  below: number
  tabs?: number
}): number {
  const fromTop = Math.round(at.windowHeight - at.top - at.below)
  const belowTabs =
    at.tabs === undefined
      ? 0
      : Math.min(MOVEMENT_TABS_ROOM, Math.round(at.windowHeight - (at.top - at.tabs) - at.below))
  return Math.max(MOVEMENT_MIN_ROOM, fromTop, belowTabs)
}
