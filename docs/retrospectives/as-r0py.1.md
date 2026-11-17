# as-r0py.1

## A timing-sensitive imageTakes and musicTakes test failed in the full suite and passed alone

**What happened.** `bun run check` failed on three of five local runs of this branch, each time on a
different test that passes alone: "adding a fine-tuned take" in `src/services/imageTakes.test.ts`
(the board's second take was missing after an `EACCES` rename in `takeOut`), and once "shows as music
on the GPU while a take is made" in `src/services/musicTakes.test.ts`. A run of `bun test` on main
passed; the last two runs of the branch passed with no change to those files.

**Why.** Not established. The `EACCES` lines in the log also appear on main (tests that make
folders read-only on purpose), so the failing assertion looks like a race between a take still being
made in the background and the test that follows, made likelier by a loaded machine (the branch's new
suites, a real `Bun.build`, add a few seconds of CPU).

**Cost.** About five extra full runs, roughly ten minutes, and the doubt whether the branch caused it.

**Prevent by.** Make the take-making tests in `imageTakes.test.ts` and `musicTakes.test.ts` await the
background work they start before asserting (a test-side wait on the board, not a sleep).

**Seen before.** Nothing like it yet in `docs/retrospectives/`.
