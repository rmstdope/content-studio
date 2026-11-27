# as-1ukd: a wait loop under Bun's fake timers hung

## What happened

The RFR-1 system test winds the studio's ten-minute limit past with `jest.useFakeTimers()`, and
first waited for the command's processes with a helper polling on `performance.now()` and
`Bun.sleep`. The test hung until Bun's per-test timeout, and left `sleep 60` processes behind on
this computer, found with `pgrep` and killed by hand.

## Why

In Bun 1.4.2 fake timers also freeze `performance.now()`, `Date.now()`, `Bun.nanoseconds()` and
`process.hrtime`, and `Bun.sleep` never resolves. `setImmediate` still runs.

## Cost

A few probe runs to find which clocks are held.

## Prevent by

`.cerebro/traps.md`: "Under `jest.useFakeTimers()` (Bun 1.4.2) every clock and `Bun.sleep` are
frozen; wait on outside work turn by turn with `setImmediate`, as `test/system/RFR-1.test.ts`
does."

## Seen before

No.
