import { describe, expect, it, spyOn } from 'bun:test'
import { settle } from './settle'

describe('settle', () => {
  // Reads the delays asked for, not the clock: it keeps a longer sleep from creeping back.
  it('waits five turns of the event loop, none longer than a millisecond', async () => {
    const timers = spyOn(globalThis, 'setTimeout')
    try {
      await settle()
      expect(timers.mock.calls.map((call) => call[1])).toEqual([1, 1, 1, 1, 1])
    } finally {
      timers.mockRestore()
    }
  })

  it('lets work chained over zero-delay timers finish', async () => {
    let done = 0
    const step = () => {
      if (++done < 5) setTimeout(step, 0)
    }
    setTimeout(step, 0)
    await settle()
    expect(done).toBe(5)
  })
})
