# as-evwv

## A music spending test failed once in CI and passed on re-run

**What happened.** CI on PR #618 failed `server, what music takes cost > lists a paid take on the Spending page, in its act, and a free one not` (`src/server/music.test.ts:201`): the Spending page answered every act with `credits: 0, total: 0`. The change touched only `src/core/imagePatches.ts`. The same suite passed three times locally, and the failed job passed on one bare re-run.

**Why.** Not established.

**Cost.** About five minutes of CI and one of the bead's two re-runs.

**Prevent by.** Not established; a fix needs the test run in a loop under CI-like load to find what it races on.

**Seen before.** Nothing like it yet in `docs/retrospectives/`.
