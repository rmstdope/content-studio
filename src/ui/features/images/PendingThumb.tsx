import { useLayoutEffect, useRef } from 'react'
import type { ImageFailedView, ImageMakingView } from '../../../core/imageTakes'
import { imageTimeLeftText } from '../../imageTakesText'
import { progressOf } from '../../musicTakesText'
import type { OffProps } from '../../off'

/**
 * A take with no picture yet, in the strip: waiting or being made, with its time and a progress
 * bar, or failed, with why and Try again. One element for all of these, so keyboard focus stays on
 * it from Try again until the take is made; `onGone` then says that it left while it held focus.
 */
export function PendingThumb({
  take,
  width,
  height,
  retryOff,
  onRetry,
  onGone,
}: {
  take: { making: ImageMakingView } | { failed: ImageFailedView }
  width: number
  height: number
  /** Why Try again is off, as the props that grey it. */
  retryOff: OffProps
  onRetry: () => void
  onGone: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const gone = useRef(onGone)
  gone.current = onGone
  // A layout effect: its clean-up runs while the element is still on the page and holds focus.
  useLayoutEffect(() => {
    const element = ref.current
    return () => {
      if (element?.contains(document.activeElement)) gone.current()
    }
  }, [])
  const failed = 'failed' in take ? take.failed : null
  const making = 'making' in take ? take.making : null
  const n = 'failed' in take ? take.failed.n : take.making.n
  const shape = { aspectRatio: `${width} / ${height}` }
  return (
    <div
      ref={ref}
      className={`image-thumb ${failed ? 'image-thumb-failed' : 'image-thumb-making'}`}
      role="group"
      aria-label={`Take ${n}`}
      tabIndex={-1}
    >
      {failed ? (
        <div className="image-thumb-well" style={shape} aria-hidden="true">
          !
        </div>
      ) : (
        <div className="image-take-empty" style={shape} />
      )}
      <span className="image-thumb-label">
        <span className="grow">Take {n}</span>
      </span>
      {failed && (
        <>
          <span className="image-thumb-what">Could not be made</span>
          <span className="image-thumb-why">{failed.message}</span>
          <button
            type="button"
            className="btn btn-small"
            {...retryOff}
            onClick={() => {
              // The button goes as the take is made again; the tile stays, so focus waits on it.
              ref.current?.focus({ preventScroll: true })
              onRetry()
            }}
          >
            Try again
          </button>
        </>
      )}
      {making && (
        <>
          <span className="faint small">{imageTimeLeftText(making)}</span>
          <div className="bar" role="progressbar" aria-label={`Take ${n}`}>
            <i style={{ width: `${Math.round(progressOf(making) * 100)}%` }} />
          </div>
        </>
      )}
    </div>
  )
}
