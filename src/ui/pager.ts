import { neighbours } from '../core/neighbours'
import type { PagerProps, PagerStep } from './components/Pager'
import { PRESSED_INPUTS } from './pressedInputs'

/** A key press as far as the previous/next control cares. */
export interface PagerPress {
  key: string
  /** Cmd, Ctrl or Alt held: the browser's shortcut. */
  modifier: boolean
  target: {
    tagName: string
    isContentEditable?: boolean
    /** The closest ancestor (or itself) matching a selector; non-null inside a control that uses the arrows. */
    closest: (selector: string) => unknown
  }
}

/** What makes up a dialog, which keeps its keys. */
const DIALOGS = ['.modal-back', '[role="dialog"]', '[role="alertdialog"]']

/** The selector for controls that use ← and → themselves (a take strip, the scene list, sliders, menus, tabs, radios) and dialogs. */
export const ARROW_USERS = [
  '[data-strip]',
  '.scene-list',
  ...DIALOGS,
  '[role="menu"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
].join(', ')

/**
 * Where Shift with ← or → is not the previous/next control's: dialogs, and a control marked as
 * keeping those keys while it has focus (a selected named area box, a fade handle).
 */
const SHIFT_ARROW_KEEPERS = [...DIALOGS, '[data-keeps-shift-arrows]'].join(', ')

/**
 * Which way ← or → steps: -1 or 1, or null when the press is not the control's: another key, a
 * modified one, typing in a field, or inside a control that uses the arrows itself.
 */
export function pagerStep({ key, modifier, target }: PagerPress): -1 | 1 | null {
  if (modifier) return null
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName.toUpperCase())) return null
  if (target.isContentEditable) return null
  if (target.closest(ARROW_USERS)) return null
  return key === 'ArrowLeft' ? -1 : 1
}

/** A press as far as Shift with ← and → cares. */
export interface ShiftPagerPress extends PagerPress {
  shift: boolean
  /** A modal backdrop or full screen hides the previous/next control. */
  covered: boolean
  target: PagerPress['target'] & {
    /** An input's type. */
    type?: string
  }
}

/**
 * Which way Shift with ← or → steps, from anywhere on the page: -1 or 1, or null when the press is
 * not the control's: no Shift or another modifier too, another key, the control covered, typing in
 * a field (where it selects text), in a dialog, or on a control that keeps these keys.
 */
export function shiftPagerStep(press: ShiftPagerPress): -1 | 1 | null {
  const { key, shift, modifier, covered, target } = press
  if (!shift || modifier || covered) return null
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const tag = target.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return null
  if (tag === 'INPUT' && !PRESSED_INPUTS.has(target.type ?? 'text')) return null
  if (target.closest(SHIFT_ARROW_KEEPERS)) return null
  return key === 'ArrowLeft' ? -1 : 1
}

/**
 * The props of the control for the item `id` of `items`: its place and its neighbours, each as the
 * `step` function names and addresses it. Null when the list does not hold the item.
 */
export function pagerFor<T extends { id: string }>(
  items: readonly T[],
  id: string,
  step: (item: T) => PagerStep,
): PagerProps | null {
  const around = neighbours(items, id)
  if (!around) return null
  return {
    place: { position: around.position, count: around.count },
    previous: around.previous && step(around.previous),
    next: around.next && step(around.next),
  }
}
