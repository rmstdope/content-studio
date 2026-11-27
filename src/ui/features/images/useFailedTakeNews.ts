import { useEffect, useRef, useState } from 'react'
import { newFailuresText, takeFailedText } from '../../imageTakesText'

/**
 * What a screen reader hears of takes failing: `said` is for a live region. `failed` is the numbers
 * of the failed takes at the latest read (null before the first): those there at the first read are
 * not spoken, each later one is as it appears. `retrying` empties the region when Try again is
 * pressed, so the same sentence is heard anew; `retried` takes the read that followed the press and
 * speaks a take that had already failed again by then, which the reads may never show as being made.
 */
export function useFailedTakeNews(failed: readonly number[] | null) {
  const known = useRef<ReadonlySet<number> | null>(null)
  const [said, setSaid] = useState('')
  const key = failed?.join(' ') ?? null
  useEffect(() => {
    if (!failed) return
    if (known.current) setSaid(newFailuresText(known.current, failed))
    known.current = new Set(failed)
    // The numbers are the news; a new array of the same ones is none.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return {
    said,
    retrying: () => setSaid(''),
    retried: (n: number, failedNow: readonly number[]) => {
      if (failedNow.includes(n)) setSaid(takeFailedText(n))
    },
  }
}
