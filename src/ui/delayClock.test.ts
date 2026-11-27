import { describe, expect, it } from 'bun:test'
import { browserClock } from './delayClock'

describe("the browser's clock", () => {
  it('calls after its delay, and never once cancelled', async () => {
    const calls: string[] = []
    const asked = browserClock.now()
    browserClock.after(1, () => calls.push('cancelled'))()
    await new Promise<void>((done) => browserClock.after(5, done))
    expect(calls).toEqual([])
    expect(browserClock.now()).toBeGreaterThan(asked)
  })
})
