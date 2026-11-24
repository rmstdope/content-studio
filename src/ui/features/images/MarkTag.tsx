import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { PatchArea } from '../../../core/imagePatches'
import {
  CHANGE_BADGE,
  CHANGE_LINE,
  SMALL_MARK_ADVICE,
  smallMarkHead,
  type TakeChange,
} from '../../../core/imageSmallMark'
import { tagSide } from '../../markTag'

/**
 * The tag beside a mark too small for the edit model: its size in the take's pixels and what to do.
 * It sits inside the picture's stage, at the mark's right, or its left where the right has no room.
 * `placed` is the mark where it is drawn, `size` its size in the take's pixels, `picture` the size
 * `placed` is in. Not focusable, and it adds no shortcut.
 */
export function MarkTag({
  placed,
  picture,
  size,
}: {
  placed: PatchArea
  picture: { width: number; height: number }
  size: { width: number; height: number }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)
  useLayoutEffect(() => {
    const measure = () => setStage(ref.current?.parentElement?.getBoundingClientRect().width ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const side = tagSide(placed, picture, stage)
  const style: CSSProperties = {
    top: `min(${(placed.y / picture.height) * 100}%, calc(100% - 4.5em))`,
    ...(side === 'right'
      ? { left: `calc(${((placed.x + placed.width) / picture.width) * 100}% + 8px)` }
      : { right: `calc(${(1 - placed.x / picture.width) * 100}% + 8px)` }),
  }
  return (
    <div ref={ref} className="mark-tag" data-side={side} style={style}>
      <b>{smallMarkHead(size)}</b> {SMALL_MARK_ADVICE}
    </div>
  )
}

/** The amber badge of a take that changed nothing, or very little. */
export function ChangeBadge({ change }: { change: TakeChange }) {
  return <span className="change-badge">{CHANGE_BADGE[change]}</span>
}

/** The badge and its one-line explanation, as the take's row shows them. */
export function ChangeNote({ change }: { change: TakeChange }) {
  return (
    <>
      <ChangeBadge change={change} />
      <span className="faint small">{CHANGE_LINE[change]}</span>
    </>
  )
}
