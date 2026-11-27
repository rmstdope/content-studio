/**
 * The clock a view's own delays run on: the time in milliseconds, and a later call that can be
 * cancelled. A view takes one, so a test can give its own.
 */
export interface DelayClock {
  now(): number
  after(ms: number, fn: () => void): () => void
}

/** The browser's clock: `Date.now` and a timeout. */
export const browserClock: DelayClock = {
  now: () => Date.now(),
  after(ms, fn) {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}
