import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { isWholeArea, wholeArea, type PatchArea } from '../../../core/imagePatches'
import { smallMark, smallMarkText } from '../../../core/imageSmallMark'
import { areaFromDrag } from '../../imagePatchArea'
import { modelSpace, type PatchSpace } from '../../patchGameSpace'
import { isWholeKey } from '../../wholeMark'
import { MarkTag } from './MarkTag'
import { typesText } from './useWorkbenchKeys'
import { onWholeMarkLink } from './WholeMarkLink'

/** Where an area lies on a picture of this size, in the percentages the page draws with. */
function placed(area: PatchArea, size: { width: number; height: number }): CSSProperties {
  // A mark can reach past the part the game's version shows; it is drawn up to that picture's edge.
  const within = (at: number, side: number) => Math.min(Math.max(at, 0), side) / side
  const left = within(area.x, size.width)
  const top = within(area.y, size.height)
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(within(area.x + area.width, size.width) - left) * 100}%`,
    height: `${(within(area.y + area.height, size.height) - top) * 100}%`,
  }
}

/** What a workbench says of its mark: the part that differs between them. */
export interface WorkbenchMarkOn {
  /** The picture that is marked, in its own pixels: the ones the mark is in. */
  take: { width: number; height: number }
  /** The mark, kept by the workbench; null for none. */
  mark: PatchArea | null
  /** Keeps a new mark. */
  onMark: (area: PatchArea) => void
  /** The picture the stage draws, when it is not the marked one itself (the game's version). */
  shown?: PatchSpace
  /** Whether the box and its tag are left undrawn, a take of the same area lying over them. */
  covered?: boolean
  /** Moves focus on once the link that marked the whole picture is gone. */
  onLinkGone: () => void
}

/** The mark of a workbench, ready to put on its stage. */
export interface WorkbenchMark {
  /** Whether the whole picture is marked. */
  whole: boolean
  /** The pointer handlers of the stage, which a drag marks. */
  stage: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: () => void
  }
  /** What the stage draws of the mark: its box, the small-mark tag and what a screen reader is told. */
  drawn: ReactNode
  /** Marks the whole picture; `fromLink` when the link that does it was pressed or has focus. */
  markWhole: (fromLink?: boolean) => void
  /** Takes ⌘A (Ctrl+A) outside a text field as marking the whole picture; whether it did. */
  wholeKey: (event: KeyboardEvent) => boolean
}

/**
 * The mark of an image workbench: dragging it, warning that it is too small for the edit model, and
 * marking the whole picture. Call the hook with the others, then what it returns in the render body
 * once there is a picture to mark.
 */
export function useWorkbenchMark(): (on: WorkbenchMarkOn) => WorkbenchMark {
  const start = useRef<{ x: number; y: number } | null>(null)
  // What a screen reader is told when a drag ends on a mark too small to change anything.
  const [announced, setAnnounced] = useState('')
  return ({ take, mark, onMark, shown = modelSpace(take), covered = false, onLinkGone }) => {
    const small = smallMark(mark, take)
    const dragTo = (event: PointerEvent<HTMLElement>) => {
      if (!start.current) return
      const dragged = areaFromDrag(
        start.current,
        { x: event.clientX, y: event.clientY },
        event.currentTarget.getBoundingClientRect(),
        shown,
        shown.unplace,
        take,
      )
      // A click, or a drag too small to change, changes nothing.
      if (dragged) onMark(dragged)
      return dragged
    }
    const markWhole = (fromLink = onWholeMarkLink()) => {
      onMark(wholeArea(take))
      setAnnounced('')
      if (fromLink) onLinkGone()
    }
    const box = !covered && mark ? shown.place(mark) : null
    return {
      whole: isWholeArea(mark, take),
      stage: {
        onPointerDown: (event) => {
          if (event.button !== 0 || event.ctrlKey) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          start.current = { x: event.clientX, y: event.clientY }
          setAnnounced('')
        },
        onPointerMove: dragTo,
        onPointerUp: (event) => {
          const dragged = dragTo(event)
          if (dragged) {
            const tooSmall = smallMark(dragged, take)
            setAnnounced(tooSmall ? smallMarkText(tooSmall) : '')
          }
          start.current = null
        },
        onPointerCancel: () => {
          start.current = null
        },
      },
      drawn: (
        <>
          {box && (
            <div
              className={`patch-mark${small ? ' patch-mark-small' : ''}`}
              style={placed(box, shown)}
            />
          )}
          {box && small && <MarkTag placed={box} picture={shown} size={small} />}
          <span className="sr-only" aria-live="polite">
            {small ? announced : ''}
          </span>
        </>
      ),
      markWhole,
      wholeKey: (event) => {
        if (!isWholeKey(event) || typesText(event.target)) return false
        event.preventDefault()
        markWhole()
        return true
      },
    }
  }
}
