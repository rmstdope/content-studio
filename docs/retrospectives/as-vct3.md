# as-vct3 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-11-27
- **PR:** #756

## A new system test passed alone and in the full gate, and failed in CI

**What happened.** SCN-2's first CI run read the scene list with the last scene still "1 effect":
the lock held all three figures, the page had not drawn the last one. Waiting on `isFetching()` and
`isMutating()` too still failed about one local run in two: both read 0 a few milliseconds before
React draws the answer.
**Why.** The wait was on what the studio had written and one line of the page, not on the page
having drawn the answer; TanStack Query tells its observers after the cache is filled. Delaying
`/api/project` in the test's `fetch` reproduced it at once. Separately, one local run under a load
average of about 20 took longer than the test's 20-second wait to measure three scenes.
**Cost.** One CI cycle and some fifty repeat runs of the test.
**Prevent by.** A system test that waits for a rendered page requires its condition twice with an
`act` turn between (as `until` in `test/system/SCN-2.test.ts`), and is run once with the slow
answer delayed before the pull request is opened.
**Seen before.** as-9tsp.
