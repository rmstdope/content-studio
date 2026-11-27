import { cssLength, valuesInEveryWindow } from './stylesheet'

/**
 * The pictures Fine-tune, Patches and Named areas are all held to the same width with (as-5068), and
 * the size each is drawn at in a panel 1200 px wide, in a window 900 px high: `drawn` the whole take
 * (Fine-tune), `cut` the image's cut of it (Named areas, and Patches' game view).
 */
export const SAME_SIZE = [
  // 92% of the window's height holds it: 828 high.
  {
    what: 'a portrait picture',
    width: 816,
    height: 1024,
    game: { width: 408, height: 512 },
    drawn: [660, 828],
    cut: [660, 828],
  },
  // Its own pixels hold it.
  {
    what: 'a landscape picture',
    width: 1024,
    height: 640,
    game: { width: 512, height: 320 },
    drawn: [1024, 640],
    cut: [1024, 640],
  },
  // A model's take a few rows taller than the image: the whole take is what holds all three (as-fuaz).
  {
    what: 'a take a little off the image’s shape',
    width: 816,
    height: 1024,
    game: { width: 160, height: 200 },
    drawn: [660, 828],
    cut: [660, 825],
  },
  // Cut at the sides: what the game keeps holds all three, in its own shape.
  {
    what: 'a take cut at the sides',
    width: 1024,
    height: 512,
    game: { width: 320, height: 200 },
    drawn: [819, 410],
    cut: [819, 512],
  },
] as const

/**
 * The width and height, in whole px, that the stylesheet and the inline style give a picture's box
 * in a panel 1200 px wide, in a window 900 px high: happy-dom lays nothing out, so the one width
 * rule is worked out here, with the box's own ratio, pinned bar and widest size, and its height from
 * the shape the box has.
 */
export function drawnSize(box: HTMLElement): [number, number] {
  const widths = valuesInEveryWindow(box, 'width')
  if (widths.length !== 1) throw new Error(`Not one width rule: ${widths.join(' | ')}`)
  const bar = box.style.getPropertyValue('--bar-height') || '0px'
  const ratio = Number(box.style.getPropertyValue('--picture-ratio'))
  const rule = widths[0]!.slice(widths[0]!.indexOf(': ') + 2).replace('var(--bar-height, 0px)', bar)
  const width = Math.min(
    cssLength(rule, { percent: 1200, vh: 900, ratio }),
    parseFloat(box.style.maxWidth),
  )
  const [across, down] = box.style.aspectRatio.split('/').map(Number)
  return [Math.round(width), Math.round((width * down!) / across!)]
}
