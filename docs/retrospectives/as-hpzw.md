# as-hpzw — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #717

## The gate failed twice at an unchanged head, on tests the diff does not touch

**What happened.** At `95f341b2`, `bun run check` run three times failed, failed, passed. The first
run had 2 failures, whose names were lost: I had kept only the output's last 30 lines. The second
had 1: `a local generator stops with the studio > stops an image take, and what it started, on
SIGTERM` (`src/services/stopWithStudio.test.ts:45`), the child still alive after the studio exited.
The file run alone passed 4 of 4. The diff changes only system tests and the requirements list.

**Why.** Not established. A likely cause is load: the test gives the child 20 × 50 ms to be gone,
and shortly afterwards `uptime` showed load averages of 12, 38 and 49 (1, 5 and 15 minutes).

**Cost.** Three more runs of the gate, a few minutes.

**Prevent by.** In `src/services/stopWithStudio.test.ts`, wait for the child to be gone with the
same generous give-up time the system tests use (10 s) instead of a fixed 1 s. When running the
gate, send its output to a file and read the `(fail)` lines from it, never `| tail`.

**Seen before.** None found for this test.
