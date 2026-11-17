import type { SavedZoom } from './images'
import { numberText } from './motion'

/** What the game plays when an image has no zoom saved: on, 16 s each way, 3%. */
export const GAME_ZOOM = { seconds: 16, percent: 3 } as const

/** The slow zoom's two sliders as the game accepts them: seconds each way, and how far in percent. */
export const ZOOM_RANGE = {
  seconds: { min: 4, max: 60, step: 1 },
  percent: { min: 0.5, max: 10, step: 0.5 },
} as const

/** What the zoom is set to now: nothing saved is the game's own, and a saved value is held to the game's range. */
export function zoomValues(saved: SavedZoom | undefined): SavedZoom {
  const hold = (n: number, { min, max }: { min: number; max: number }) =>
    Math.min(max, Math.max(min, n))
  return {
    on: saved?.on ?? true,
    seconds: hold(saved?.seconds ?? GAME_ZOOM.seconds, ZOOM_RANGE.seconds),
    percent: hold(saved?.percent ?? GAME_ZOOM.percent, ZOOM_RANGE.percent),
  }
}

/** Whether the saved zoom differs from the game's own (on, 16 s, 3%), which is when Reset shows. */
export function zoomDiffers(saved: SavedZoom | undefined): boolean {
  if (!saved) return false
  return !saved.on || saved.seconds !== GAME_ZOOM.seconds || saved.percent !== GAME_ZOOM.percent
}

/** A number of seconds as the slider shows it: "24 s". */
export function secondsText(n: number): string {
  return `${numberText(n)} s`
}

/** A percentage as the slider shows it: "5%". */
export function percentText(n: number): string {
  return `${numberText(n)}%`
}

/** The line for one value saved outside the game's range, or null when it is inside. */
function rangeLine(
  title: string,
  saved: number,
  range: { min: number; max: number },
  text: (n: number) => string,
): string | null {
  if (saved >= range.min && saved <= range.max) return null
  const high = saved > range.max
  const limit = high ? range.max : range.min
  return `${title} was saved as ${text(saved)}; the game goes ${high ? 'up' : 'down'} to ${numberText(limit)}, so it plays ${numberText(limit)}.`
}

/** The amber lines for values saved outside the game's range (edited by hand), saying what the game plays. */
export function zoomRangeNotes(saved: SavedZoom | undefined): string[] {
  if (!saved) return []
  return [
    rangeLine('Each way', saved.seconds, ZOOM_RANGE.seconds, secondsText),
    rangeLine('How far', saved.percent, ZOOM_RANGE.percent, percentText),
  ].filter((line): line is string => line !== null)
}

/** How the stage zooms: seconds each way, the scale it reaches, and the small drift (in percent) that goes with it. */
export interface ZoomLook {
  seconds: number
  scale: number
  x: number
  y: number
}

/** The look of a zoom for the stage; null while it is off (the picture stands still). The drift is the old 3% look scaled by how far. */
export function zoomLook(values: SavedZoom): ZoomLook | null {
  if (!values.on) return null
  const k = values.percent / GAME_ZOOM.percent
  return {
    seconds: values.seconds,
    scale: Number((1 + values.percent / 100).toFixed(4)),
    x: -0.5 * k,
    y: -0.3 * k,
  }
}
