import { useEffect, useId, useRef, useState, type PointerEvent, type MouseEvent } from 'react'
import type { SpotMark, SpotShape } from '../../../core/images'
import {
  clampUnit,
  moveCorner,
  moveMark,
  removeCorner,
  replaceShape,
  shapeAt,
} from '../../../core/spot'

/** How near, in screen pixels, a press must be to a corner to take it. */
const GRAB = 10
/** The radius, in screen pixels, of the picked shape's corner dots and of the first corner of a new shape. */
const DOT = 6
const FIRST = 9
/** The radii, in screen pixels, of the light's mark: its dot and the dashed ring round it. */
const MARK_DOT = 5
const MARK_RING = 11

/** What the overlay shows and how a person's presses on it are reported. */
export interface SpotOverlayProps {
  /** The effect's shapes as they stand. */
  spot: readonly SpotShape[]
  /** `peek` only outlines them; `draw` dims the rest of the picture and takes the presses. */
  mode: 'peek' | 'draw'
  /** The picked shape, if any (drawing). */
  picked: number | null
  /** The corners of the shape being placed, or null when none is. */
  placing: [number, number][] | null
  /** A shape was clicked, or the picture outside them (null). */
  onPick: (shape: number | null) => void
  /** A corner was placed. */
  onPlace: (corners: [number, number][]) => void
  /** The first corner was clicked with three or more placed: the shape is closed. */
  onClose: (shape: SpotShape) => void
  /** Where the light's mark is drawn (drawing; null: no mark yet) or, when it was moved, the small dot shown (looking). */
  mark: SpotMark | null
  /** The mark was dragged to a place. */
  onMark: (mark: SpotMark) => void
  /** The shapes changed (a corner moved or taken out). */
  onChange: (spot: SpotShape[]) => void
  /** The change is done and should be kept (a corner let go of or taken out). */
  onCommit: () => void
}

/**
 * An effect's shapes over the picture, in screen pixels: outlined in light blue to look at, or
 * drawn on: dimmed outside, the picked shape's corners as dots, new corners placed by clicking.
 * It keeps no copy of the shapes; the panel owns them.
 */
export function SpotOverlay(props: SpotOverlayProps) {
  const { spot, mode, picked, placing } = props
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const mask = useId().replace(/:/g, '')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [mouse, setMouse] = useState<[number, number] | null>(null)
  const drag = useRef<{
    shape: number
    corner: number
    moved: boolean
    from: [number, number]
  } | null>(null)
  const markDrag = useRef<{ moved: boolean; from: [number, number]; at: [number, number] } | null>(
    null,
  )

  useEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    watcher?.observe(element)
    return () => watcher?.disconnect()
  }, [])

  const { w, h } = size
  const px = (corner: readonly [number, number]) => `${corner[0] * w},${corner[1] * h}`
  const points = (shape: readonly (readonly [number, number])[]) =>
    shape.map((corner) => px(corner)).join(' ')

  /** Where a pointer event is, as fractions of the picture. */
  const at = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = root.current!.getBoundingClientRect()
    return [
      (event.clientX - rect.left) / (rect.width || w || 1),
      (event.clientY - rect.top) / (rect.height || h || 1),
    ]
  }
  /** The index of the corner of `shape` within grabbing distance of the fractions, or null. */
  const cornerAt = (shape: SpotShape, [x, y]: [number, number]): number | null => {
    const found = shape.findIndex(([cx, cy]) => Math.hypot((cx - x) * w, (cy - y) * h) <= GRAB)
    return found < 0 ? null : found
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const now = latest.current
    const [x, y] = at(event)
    if (now.placing) {
      const first = now.placing[0]
      if (first && cornerAt([first], [x, y]) === 0) {
        if (now.placing.length >= 3) now.onClose(now.placing)
        return
      }
      now.onPlace([...now.placing, [clampUnit(x), clampUnit(y)]])
      return
    }
    if (now.mark && cornerAt([now.mark], [x, y]) === 0) {
      markDrag.current = { moved: false, from: [event.clientX, event.clientY], at: [x, y] }
      try {
        root.current?.setPointerCapture?.(event.pointerId)
      } catch {
        // A pointer that is already gone cannot be captured; the drag still follows the events it gets.
      }
      return
    }
    if (now.picked !== null && now.spot[now.picked]) {
      const corner = cornerAt(now.spot[now.picked]!, [x, y])
      if (corner !== null) {
        drag.current = {
          shape: now.picked,
          corner,
          moved: false,
          from: [event.clientX, event.clientY],
        }
        try {
          root.current?.setPointerCapture?.(event.pointerId)
        } catch {
          // A pointer that is already gone cannot be captured; the drag still follows the events it gets.
        }
        return
      }
    }
    now.onPick(shapeAt(now.spot, x, y))
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const now = latest.current
    const [x, y] = at(event)
    const dragging = drag.current
    const marking = markDrag.current
    if (marking) {
      if (
        !marking.moved &&
        Math.hypot(event.clientX - marking.from[0], event.clientY - marking.from[1]) < 3
      )
        return
      marking.moved = true
      now.onMark(moveMark(x, y))
    } else if (dragging) {
      if (
        !dragging.moved &&
        Math.hypot(event.clientX - dragging.from[0], event.clientY - dragging.from[1]) < 3
      )
        return
      dragging.moved = true
      now.onChange(
        replaceShape(
          now.spot,
          dragging.shape,
          moveCorner(now.spot[dragging.shape]!, dragging.corner, x, y),
        ),
      )
    } else if (now.placing) {
      setMouse([x, y])
    }
  }
  const up = () => {
    const dragging = drag.current
    const marking = markDrag.current
    drag.current = null
    markDrag.current = null
    if (dragging?.moved || marking?.moved) latest.current.onCommit()
    // A press on the mark that goes nowhere is a click on the picture under it.
    else if (marking)
      latest.current.onPick(shapeAt(latest.current.spot, marking.at[0], marking.at[1]))
  }
  const twice = (event: MouseEvent<HTMLDivElement>) => {
    const now = latest.current
    if (now.placing || now.picked === null || !now.spot[now.picked]) return
    const corner = cornerAt(now.spot[now.picked]!, at(event))
    if (corner === null) return
    const next = removeCorner(now.spot[now.picked]!, corner)
    if (next) {
      now.onChange(replaceShape(now.spot, now.picked, next))
      now.onCommit()
    }
  }

  const drawing = mode === 'draw'
  const last = placing && placing.length > 0 ? placing[placing.length - 1]! : null
  return (
    <div
      ref={root}
      className={drawing ? 'spot-overlay spot-overlay-draw' : 'spot-overlay'}
      onPointerDown={drawing ? down : undefined}
      onPointerMove={drawing ? move : undefined}
      onPointerUp={drawing ? up : undefined}
      onPointerCancel={drawing ? up : undefined}
      onDoubleClick={drawing ? twice : undefined}
    >
      <svg width={w} height={h} aria-hidden="true">
        {drawing && (
          <>
            <defs>
              <mask id={mask}>
                <rect width={w} height={h} fill="#fff" />
                {spot.map((shape, i) => (
                  <polygon key={i} points={points(shape)} fill="#000" />
                ))}
              </mask>
            </defs>
            <rect className="spot-dim" width={w} height={h} mask={`url(#${mask})`} />
          </>
        )}
        {spot.map((shape, i) => (
          <polygon
            key={i}
            points={points(shape)}
            className={
              !drawing ? 'spot-peek' : i === picked ? 'spot-edge spot-edge-picked' : 'spot-edge'
            }
          />
        ))}
        {drawing &&
          picked !== null &&
          spot[picked]?.map((corner, i) => (
            <circle key={i} className="spot-corner" cx={corner[0] * w} cy={corner[1] * h} r={DOT} />
          ))}
        {!drawing && props.mark && (
          <circle className="spot-peek-mark" cx={props.mark[0] * w} cy={props.mark[1] * h} r={4} />
        )}
        {drawing && props.mark && (
          <g data-at={`${props.mark[0]},${props.mark[1]}`} className="spot-mark">
            <circle
              className="spot-mark-ring"
              cx={props.mark[0] * w}
              cy={props.mark[1] * h}
              r={MARK_RING}
            />
            <circle cx={props.mark[0] * w} cy={props.mark[1] * h} r={MARK_DOT} />
          </g>
        )}
        {drawing && placing && placing.length > 0 && (
          <>
            <polyline className="spot-placing" points={points(placing)} />
            {last && mouse && (
              <line
                className="spot-rubber"
                x1={last[0] * w}
                y1={last[1] * h}
                x2={mouse[0] * w}
                y2={mouse[1] * h}
              />
            )}
            {placing.map((corner, i) => (
              <circle
                key={i}
                className={i === 0 ? 'spot-first' : 'spot-placed'}
                cx={corner[0] * w}
                cy={corner[1] * h}
                r={i === 0 ? FIRST : DOT - 2}
              />
            ))}
          </>
        )}
      </svg>
    </div>
  )
}
