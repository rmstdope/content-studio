import type { ComponentProps, CSSProperties } from 'react'
import { markedFit } from '../../../core/imagePixels'

/**
 * The box of a picture that is marked on, on Fine-tune, Patches and Named areas: as wide as the
 * panel, never wider than the pixels the image keeps of the take, and never so wide that it is
 * taller than the window holds. The width comes from the take and the image alone (`markedFit`), so
 * the three tabs draw one take at one width. The one width rule is `.whole-in-view` in the
 * stylesheet; this gives it the shape and the cap. Everything else is an ordinary `div`.
 */
export function FitPicture({
  shape,
  take,
  game,
  barHeight,
  className,
  ...div
}: Omit<ComponentProps<'div'>, 'style'> & {
  /** The shape the picture is shown at: the whole take's, or the image's. */
  shape: { width: number; height: number }
  /** The size of the take drawn in it. */
  take: { width: number; height: number }
  /** The size the game shows the image at. */
  game: { width: number; height: number }
  /** The height in px of a bar pinned at the window's top, over the picture. */
  barHeight?: number
}) {
  const fit = markedFit(take, game)
  const style = {
    aspectRatio: `${shape.width} / ${shape.height}`,
    '--picture-ratio': fit.ratio,
    ...(barHeight !== undefined && { '--bar-height': `${barHeight}px` }),
    maxWidth: `${fit.pixels}px`,
  } as CSSProperties
  return (
    <div
      {...div}
      className={className ? `${className} whole-in-view` : 'whole-in-view'}
      style={style}
    />
  )
}
