import { useCallback, useEffect, useRef, useState } from 'react'

/** Which of the two sounds is heard. */
export type Side = 'recorded' | 'cleaned'

/**
 * One clip looping until stopped, as recorded, and, once its cleaned copy is there, the cleaned
 * copy playing silently in step with it: `side` says which is heard. Flipping `side` only mutes
 * one and unmutes the other (and brings them to the same moment), so the line never starts over.
 * It stops when the clip changes, and when the page is left. `position` and `length` are the
 * recorded clip's, in seconds.
 */
export function useCompareLoop(recorded: string | null, cleaned: string | null, side: Side) {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ position: 0, length: 0 })
  const first = useRef<HTMLAudioElement | null>(null)
  const second = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    first.current?.pause()
    second.current?.pause()
    first.current = null
    second.current = null
    setPlaying(false)
    setTime({ position: 0, length: 0 })
  }, [])

  // A different clip, or leaving the page, ends the loop.
  useEffect(() => stop, [recorded, stop])

  const toggle = useCallback(() => {
    if (first.current) return stop()
    if (!recorded) return
    const element = new Audio(recorded)
    element.loop = true
    const note = () =>
      setTime({
        position: element.currentTime,
        length: Number.isFinite(element.duration) ? element.duration : 0,
      })
    element.addEventListener('timeupdate', note)
    element.addEventListener('loadedmetadata', note)
    first.current = element
    setPlaying(true)
    void element.play().catch(() => {
      if (first.current === element) stop()
    })
  }, [recorded, stop])

  // The cleaned copy joins in at the moment the recorded one has got to.
  useEffect(() => {
    if (!playing || !cleaned || !first.current || second.current) return
    const element = new Audio(cleaned)
    element.loop = true
    element.currentTime = first.current.currentTime
    second.current = element
    void element.play().catch(() => {})
  }, [playing, cleaned])

  // Only the side chosen is heard; the other keeps time silently.
  useEffect(() => {
    const one = first.current
    const other = second.current
    if (!one) return
    if (!other) {
      one.muted = false
      return
    }
    other.currentTime = one.currentTime
    one.muted = side === 'cleaned'
    other.muted = side === 'recorded'
  }, [side, playing, cleaned])

  return { playing, toggle, stop, ...time }
}
