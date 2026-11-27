# as-7pd8 — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-27
- **PR:** #682

## A failing `toBeNull()` on a happy-dom element made `bun test` look hung

**What happened.** With the new tests written and the code not yet changed (the expected red),
`bun test src/ui` did not finish: after the 120 s tool timeout it was still running at 98% of a CPU
with 2.9 GB resident, and had printed no result. It was killed. With the new assertions written as
`expect(element === null).toBe(true)`, each of the same files failed or passed within the 60 s
alarm put on it, with ordinary failure times of a few milliseconds.

**Why.** Not established beyond what that change shows: the likely cause is `bun test` formatting
the whole happy-dom element (with its React fields) for the failure message. `.toBeNull()` on a
present element is what the existing UI tests use, so any of them going red would do the same.

**Cost.** About five minutes, and the new assertions written twice.

**Prevent by.** A line in `.cerebro/traps.md`: in a happy-dom test, assert that an element is gone
with `expect(x === null).toBe(true)`, never `expect(x).toBeNull()`, and run a red UI test one file
at a time.

**Seen before.** none found.
