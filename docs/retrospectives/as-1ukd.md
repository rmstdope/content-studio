# as-1ukd — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #727

## A system test waiting under Bun's fake timers hung and left processes behind

**What happened.** `test/system/RFR-1.test.ts` winds the studio's ten-minute command limit past
with `jest.useFakeTimers()`, and first waited for the command's processes by polling on
`performance.now()` and `Bun.sleep`. `bun test` hung to its per-test timeout and left `sleep 60`
processes on the computer, found with `pgrep` and killed by hand.
**Why.** In Bun 1.4.2, under fake timers `performance.now()`, `Date.now()`, `Bun.nanoseconds()`
and `process.hrtime` stood still in probes, and `Bun.sleep` did not resolve. `setImmediate` ran.
**Cost.** A few probe runs to find which clocks are held.
**Prevent by.** An entry in `.cerebro/traps.md`: under `jest.useFakeTimers()` every clock and
`Bun.sleep` are held; wait on outside work turn by turn with `setImmediate`, as
`test/system/RFR-1.test.ts` does.
**Seen before.** none found.
