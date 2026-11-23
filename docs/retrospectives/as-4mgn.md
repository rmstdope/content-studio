# as-4mgn

## A timing test failed in CI and passed locally

**What happened**: CI failed on `the summary of a press on a list is kept by the studio > goes on while takes are started by hand during the press, and a new press replaces it` (`src/services/musicTakes.test.ts`), a file this bead did not touch. Three local runs of that file passed; a re-run of the failed job passed.

**Why**: not established; it looks timing-dependent (it passed in 48 ms when it failed, and the CI suite took 223 s against 170 s locally).

**Cost**: one CI cycle (about 6 minutes) and one of the two re-runs.

**Prevent by**: make that test wait on the press finishing instead of on timing.

**Seen before**: nothing like it yet.
