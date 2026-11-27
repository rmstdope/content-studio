# as-30dg — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #739

## A new happy-dom test passed alone and in the gate, and showed an empty page under plain `bun test`

**What happened.** `test/system/AGT-2.test.ts` rendered the app outside React's `act`. It passed
alone and `bun run check` passed (parallel workers). Plain `bun test`, one process, failed it:
`the page never showed "a low inn under heavy snow": ` with an empty page. The same run also fails
`src/ui/components/WhyTip.test.tsx` "updates in place when the reason changes and goes when the
control turns on", with and without this bead's test; the gate does not show it.

**Why.** For the new test: react-dom was already loaded by an earlier file, and rendering inside
`act` fixed it, so the likely cause is a scheduler bound to that file's closed window; not traced
further. For `WhyTip.test.tsx`: not established.

**Cost.** About ten minutes. It would not have shown in the gate or in CI.

**Prevent by.** In `CLAUDE.md`, _Test-driven_: a test that renders React renders and waits inside
`act`, and is also run once by plain `bun test` (the gate runs only the parallel form).

**Seen before.** as-a3qu (happy-dom state shared between files in one process).
