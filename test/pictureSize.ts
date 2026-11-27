import { cssLength, valuesInEveryWindow } from './stylesheet'

/**
 * The pictures Fine-tune, Patches and Named areas are all held to the same size with (as-5068), and
 * the size each is drawn at in a panel 1200 px wide, in a window 900 px high.
 */
export const SAME_SIZE = [
  // 92% of the window's height holds it: 828 high.
  { what: 'a portrait picture', width: 816, height: 1024, drawn: [660, 828] },
  // Its own pixels hold it.
  { what: 'a landscape picture', width: 1024, height: 640, drawn: [1024, 640] },
] as const

/**
 * The width and height, in whole px, that the stylesheet and the inline style give a picture's box
 * in a panel 1200 px wide, in a window 900 px high: happy-dom lays nothing out, so the one width
 * rule is worked out here, with the box's own ratio, pinned bar and widest size.
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
  return [Math.round(width), Math.round(width / ratio)]
}
