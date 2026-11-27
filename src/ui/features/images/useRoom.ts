import { useLayoutEffect, useState } from 'react'

/**
 * The width of an element and the height of the window it is in, measured before the first painting
 * and again when either changes; null until the element has a width. A hidden element has none, and
 * the last measure stands meanwhile. `ref` goes on the element.
 */
export function useRoom(): {
  ref: (element: HTMLElement | null) => void
  room: { width: number; windowHeight: number } | null
} {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [room, setRoom] = useState<{ width: number; windowHeight: number } | null>(null)
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const { width } = element.getBoundingClientRect()
      if (!width) return
      const windowHeight = window.innerHeight
      setRoom((was) =>
        was?.width === width && was.windowHeight === windowHeight ? was : { width, windowHeight },
      )
    }
    measure()
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    watcher?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      watcher?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [element])
  return { ref: setElement, room }
}
