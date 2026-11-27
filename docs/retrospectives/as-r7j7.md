# as-r7j7 — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-27
- **PR:** #693

## A CI time budget was met by the local run and missed in CI

**What happened.** The acceptance was a time in the CI log: `sceneAudio.test.ts` under 4 s. With the
10 s window the bead proposed, `bun test src/services/sceneAudio.test.ts` took 3.22 s locally, but
the file's tests summed to 4.55 s and 4.27 s in two CI runs (jobs 140305009040 and 140306536197).
A 5 s window gave 2.18 s (job 140307957880).

**Why.** The bead's figures came from a scratch script and the plan took the window over without
estimating the file's time on the CI runner. At 10 s the four loudness tests were 2.8 s of the file
there, and its other tests another 1.4 to 1.7 s.

**Cost.** One extra commit, gate and CI round.

**Prevent by.** `produce-bead`, _The plan_, _Validation_: where an acceptance is a CI duration,
estimate it from the current CI log's per-test times, not from a local run, before choosing values.

**Seen before.** None found.
