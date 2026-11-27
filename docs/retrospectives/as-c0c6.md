# as-c0c6: a worker-stopping test fails now and then in the full run

## stopWithStudio's SIGTERM case failed once in the parallel run

**What happened.** On a branch that adds only a system test, `bun run test` failed once in about
eight runs in `src/services/stopWithStudio.test.ts`, "stops a music or effects worker, and what it
started, on SIGTERM": after the studio had exited, the worker's child was still alive
(`expect(alive(child)).toBe(false)`, line 45). The file passed run alone.

**Why.** Not established. The test gives the child about one second to disappear after the studio
exits, on the real clock, while every core is busy.

**Cost.** Seven extra runs of the suite to find a failure with its name.

**Prevent by.** A bead for the test: wait for the child until the test's own time limit instead of
20 × 50 ms, or establish why it outlives the studio.

**Seen before.** The same family as as-ibjg, as-mirh, as-80yj and as-kw3x.1 (tests that fail only
under the full run); no retrospective names this test.

## The first failure's name was lost to `| tail`

**What happened.** The first `bun run check` was piped into `tail`, which cut off the `(fail)` line,
so whether it was the same test is not known.

**Why.** The gate command in the producer's rules does not say to keep a log.

**Cost.** Part of the seven runs above.

**Prevent by.** `produce-bead`, _Building_: run the gate into a log file and grep it for `(fail)`.

**Seen before.** as-ibjg and as-2oe say exactly this.
