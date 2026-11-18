/** The browser-storage key of where the full-screen panel was left. */
export const FLOAT_KEY = 'content-studio.movement-float'

/** A place on the screen: the panel's top left corner, in pixels. */
export interface FloatPlace {
  left: number
  top: number
}

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>

/** The browser's local storage, or nothing where it is blocked. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Moves a place so a panel of `size` lies fully inside the `screen`; one bigger than it sits at the top left. */
export function clampFloat(
  place: FloatPlace,
  size: { width: number; height: number },
  screen: { width: number; height: number },
): FloatPlace {
  const within = (at: number, room: number) => Math.max(0, Math.min(at, room))
  return {
    left: within(place.left, screen.width - size.width),
    top: within(place.top, screen.height - size.height),
  }
}

/** Where the panel was left, or null when nothing (usable) is remembered. */
export function readFloat(storage: Reader | undefined = browserStorage()): FloatPlace | null {
  try {
    const raw = storage?.getItem(FLOAT_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { left, top } = value as Record<string, unknown>
    return typeof left === 'number' && typeof top === 'number' && isFinite(left) && isFinite(top)
      ? { left, top }
      : null
  } catch {
    return null
  }
}

/** Remembers where the panel was left, in the browser only; a refused write is ignored. */
export function writeFloat(
  place: FloatPlace,
  storage: Writer | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(FLOAT_KEY, JSON.stringify(place))
  } catch {
    // The place just is not remembered.
  }
}
