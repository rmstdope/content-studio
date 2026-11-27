import type { ComponentProps, CSSProperties } from 'react'

/**
 * The box of a picture that is marked on, on Fine-tune, Patches and Named areas: as wide as the
 * panel, never wider than the pixels drawn in it, and never so wide that, at its shape, it is taller
 * than the window holds. The one width rule is `.whole-in-view` in the stylesheet; this gives it the
 * shape and the cap. Everything else is an ordinary `div`.
 */
export function FitPicture({
  shape,
  drawnWidth,
  barHeight,
  className,
  ...div
}: Omit<ComponentProps<'div'>, 'style'> & {
  /** The shape the picture is shown at. */
  shape: { width: number; height: number }
  /** How many of the picture's own pixels are drawn across, so it is never upscaled. */
  drawnWidth: number
  /** The height in px of a bar pinned at the window's top, over the picture. */
  barHeight?: number
}) {
  const style = {
    aspectRatio: `${shape.width} / ${shape.height}`,
    '--picture-ratio': shape.width / shape.height,
    ...(barHeight !== undefined && { '--bar-height': `${barHeight}px` }),
    maxWidth: `${drawnWidth}px`,
  } as CSSProperties
  return (
    <div
      {...div}
      className={className ? `${className} whole-in-view` : 'whole-in-view'}
      style={style}
    />
  )
}
