# as-ibjg

## A full check failed one test once, and its name was not kept

**What happened.** The first `bun run check` on the change (not yet committed) ended with
6431 pass, 1 fail, 1 error. Two full runs of the same code straight after passed with 0 fail, and so
did the later runs. The command was run as `bun run check 2>&1 | tail -30`, so the failing test's
`(fail)` line was cut off and which test it was is not known.

**Why.** Not established.

**Cost.** One extra full test run, and a failure nobody can follow up.

**Prevent by.** In `produce-bead`, _Building_: run the gate into a log file and search it for
`^(fail)`, never pipe it into `tail`, so the first failure keeps its name.

**Seen before.** as-mirh, as-80yj, as-kw3x.1 (flaky tests under the full run).
