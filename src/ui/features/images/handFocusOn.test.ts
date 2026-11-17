import { describe, expect, it } from 'bun:test'
import { handFocusOn } from './handFocusOn'

describe('handFocusOn', () => {
  it('focuses the target after the next tick, and ignores a missing one', async () => {
    let focused = 0
    const el = { focus: () => focused++ } as unknown as HTMLElement
    handFocusOn(() => el)
    expect(focused).toBe(0)
    await new Promise((r) => setTimeout(r, 5))
    expect(focused).toBe(1)
    handFocusOn(() => null)
    await new Promise((r) => setTimeout(r, 5))
    expect(focused).toBe(1)
  })
})
