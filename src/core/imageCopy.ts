import { z } from 'zod'
import { isCropped } from './imagePixels'

/** The body of copying another image's picture as a take: the image to copy from. */
export const CopyImageBody = z.object({ from: z.string().min(1) }).strict()

/** What `copySources` needs of an image row. */
export interface CopySourceRow {
  id: string
  title: string
  chosenTake: number | null
  width: number
  height: number
}

/** An image of the game that can be copied from. */
export interface CopySource {
  id: string
  title: string
  /** The take in the game (the one that is copied). */
  take: number
  /** The listed size, "W × H". */
  size: string
  /** Its shape is not this image's, so the copy is cropped to fit. */
  cropped: boolean
}

/** The copyable images of one act, in the game's order. */
export interface CopyGroup {
  id: string
  title: string
  images: CopySource[]
}

/**
 * The images to copy from, by act in the game's order: those with a chosen take, never the image
 * itself, an image several acts list once (under the first). An act left with none is not listed.
 * `into` is this image's size, to mark the other shapes.
 */
export function copySources(
  acts: readonly { id: string; title: string; rows: readonly CopySourceRow[] }[],
  imageId: string,
  into: { width: number; height: number },
): CopyGroup[] {
  const seen = new Set<string>()
  const groups: CopyGroup[] = []
  for (const act of acts) {
    const images: CopySource[] = []
    for (const r of act.rows) {
      if (r.id === imageId || r.chosenTake === null || seen.has(r.id)) continue
      seen.add(r.id)
      images.push({
        id: r.id,
        title: r.title,
        take: r.chosenTake,
        size: `${r.width} × ${r.height}`,
        cropped: isCropped(r, into),
      })
    }
    if (images.length) groups.push({ id: act.id, title: act.title, images })
  }
  return groups
}

/** The groups narrowed to the images whose title has `query` in it (case-insensitive); acts with none drop out. */
export function filterCopySources(groups: readonly CopyGroup[], query: string): CopyGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...groups]
  return groups
    .map((g) => ({ ...g, images: g.images.filter((i) => i.title.toLowerCase().includes(q)) }))
    .filter((g) => g.images.length)
}

/** The title of the window. */
export const copyWindowTitle = (image: string) => `Copy another image into ${image}`

/** The footer's left side once an image is picked. */
export const copyFooter = (source: string, take: number) =>
  `${source} · Take ${take} — its picture only. Its patches and named areas stay with it.`

/** The line under a cell for another size. */
export const croppedLine = (size: string) => `${size} · will be cropped to fit`

/** The green line after a copy. */
export const copiedLine = (source: string, n: number) =>
  `Copied ${source}'s picture as Take ${n}. Choose it, then fine-tune it on the Fine-tune tab.`

/** The faint line while the copy is made. */
export const copyingLine = (source: string) => `Copying ${source}'s picture…`

/** The red line when the copy failed. */
export const copyFailure = (source: string, reason: string) =>
  `${source}'s picture could not be copied: ${reason}. Nothing was added; try again.`

/** The red line when the studio gave its own sentence, which already names the picture. */
export const copyRefusal = (sentence: string) => `${sentence} Nothing was added; try again.`

/** The take's caption: where it was copied from. */
export const copiedFromCaption = (source: string, take: number) =>
  `Copied from ${source} · Take ${take}`

/** The line under a take's thumb in the strip. */
export const copiedFromThumb = (source: string) => `copied from ${source}`

/** What the window says when the search matches nothing. */
export const NO_COPY_MATCH = (query: string) => `No image matches “${query}”.`

/** What the window says when no other image has a picture. */
export const NOTHING_TO_COPY =
  'No other image in the game has a picture yet. Choose a take on another image first.'

/** The line beside the button when no other image has a picture. */
export const NO_OTHER_PICTURE = 'No other image has a picture yet.'

/** Why the button is off while the images record (the lock) cannot be read. */
export const COPY_LOCK_WHY =
  'The images lock cannot be read, so a picture cannot be copied. Fix the lock file, then reload.'

/** Why the button is off while the style has a problem: the copy could not be brought to the game's look. */
export const COPY_STYLE_WHY = 'The style needs fixing first. Fix it to copy a picture.'

/** Why the button is off while a copy is being made. */
export const COPYING_WHY = 'A picture is being copied. This turns on when it is done.'
