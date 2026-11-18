/** A reason a control is off, or something falsy when that reason does not apply. */
export type Why = string | false | null | undefined

/** The attributes of a control that is off; empty when it is on. */
export type OffProps = {
  'aria-disabled'?: true
  'aria-description'?: string
  'data-why'?: string
}

/**
 * The props that grey a control with its reason: spread them on the button, menu or field. The
 * reasons are written in the order to deal with them (something only Setup or the computer can fix,
 * then something to do on this page, then something to wait for) and the first that applies is the
 * one the tip names. None applying returns nothing, so the control is on and shows nothing new. The
 * control stays focusable; `WhyTip` shows the reason and makes the control inert.
 */
export function off(...reasons: Why[]): OffProps {
  const why = reasons.find((r): r is string => typeof r === 'string' && r !== '')
  if (why === undefined) return {}
  return { 'aria-disabled': true, 'aria-description': why, 'data-why': why }
}

/**
 * The props that give a control that stays on the studio's tip: its reason shows on hover, focus
 * or a tap like a greyed control's, but the control is not inert (a dimmed tab is still pressed).
 */
export function tipOnly(...reasons: Why[]): OffProps {
  const { 'aria-disabled': _on, ...rest } = off(...reasons)
  return rest
}

/** A rectangle in window coordinates. */
export type Rect = { left: number; top: number; width: number; height: number }
/** A width and a height. */
export type Size = { width: number; height: number }

/** The window margin a tip keeps clear of the edge. */
const EDGE = 8

/**
 * Where a tip goes: centred above its control, or below when there is no room above, and moved
 * inward so it fits inside the window, including a window narrower than the tip.
 */
export function tipPlace(
  target: Rect,
  tip: Size,
  win: Size,
  gap: number,
): { left: number; top: number; side: 'above' | 'below' } {
  const above = target.top - gap - tip.height
  const side = above >= EDGE ? 'above' : 'below'
  const top = side === 'above' ? above : target.top + target.height + gap
  const centred = target.left + target.width / 2 - tip.width / 2
  const left = Math.max(EDGE, Math.min(centred, win.width - tip.width - EDGE))
  return { left, top, side }
}

/** What a pointer event found, as plain values (see `tipReaction`). */
export type TipFacts = {
  /** A move (`pointermove`) rather than an arrival (`pointerover`). */
  moved: boolean
  /** The pointer is inside the shown tip's box. */
  onTip: boolean
  /** The control with a tip under the pointer: none, the one shown, or another. */
  over: 'none' | 'shown' | 'other'
  /** A tip is showing. */
  shown: boolean
  /** The shown control holds keyboard focus (`:focus-visible`), which keeps its tip. */
  held: boolean
  /** A linger before hiding is running. */
  lingering: boolean
}

/**
 * What the tip does about a pointer event: show the control's tip, keep the one up (end any
 * linger), hide it soon, or nothing. An arrival shows a tip; a move only keeps or lets one go, so a
 * tip closed with Esc stays closed while the pointer rests on its control. A tip held by keyboard
 * focus is not let go for the pointer being elsewhere.
 */
export function tipReaction(f: TipFacts): 'show' | 'keep' | 'hide-soon' | 'nothing' {
  if (f.onTip) return 'keep'
  if (f.over !== 'none') {
    if (!f.moved) return 'show'
    if (f.over === 'shown') return 'keep'
    return f.shown && !f.held ? 'show' : 'nothing'
  }
  if (!f.shown || f.held) return 'nothing'
  return !f.moved || !f.lingering ? 'hide-soon' : 'nothing'
}
