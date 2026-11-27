import type { DelayClock } from '../src/ui/delayClock'

/** A clock for a component test that moves only on `pass`, which runs the calls that come due. */
export function heldClock(): { clock: DelayClock; pass(ms: number): Promise<void> } {
  let now = 1_000_000
  const calls = new Set<{ at: number; fn: () => void }>()
  return {
    clock: {
      now: () => now,
      after(ms, fn) {
        const call = { at: now + ms, fn }
        calls.add(call)
        return () => void calls.delete(call)
      },
    },
    async pass(ms) {
      // Imported here, so that loading this helper never loads React before a test file's DOM is there.
      const { act } = await import('react')
      const end = now + ms
      for (;;) {
        const next = [...calls].filter((c) => c.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        calls.delete(next)
        now = next.at
        // Each in its own act, so the render it causes can ask for the next call.
        await act(async () => next.fn())
      }
      await act(async () => {
        now = end
      })
    },
  }
}
