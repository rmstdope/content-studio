# as-0j7y: `bd heartbeat` hung for minutes on a board lock, and held up the tests chained after it

**What happened.** After rebasing, I ran `bd heartbeat as-0j7y; bun test …; bun run typecheck …` in one call. The call passed its 300 s timeout with no output. `ps` showed my heartbeat, Psylocke's `bd update as-z2qd --append-notes`, another producer's `bd update rq-ko6o`, and several fleet-view `bd list` / `bd epic status` calls, all queued on the board's lock while a Dolt push ran. Run without the heartbeat in front, the same tests finished in seconds. Earlier in the pass, my `bd update … && bd dolt push` after the review comment also ran past 120 s and was moved to the background. That review's note says its reviewer hit the same lock: "`bd show` hung on a lock".

**Why.** Every `bd` call in the fleet waits on one lock, and a `bd dolt push` holds it for as long as the network push takes. `produce-bead` tells you to heartbeat inline before long work, so a blocked heartbeat blocks the work too.

**Cost.** About 6 minutes of wall clock, one gate run thrown away and run again, and a CI poll that I had to write twice, putting the heartbeat in a background subshell under `timeout`.

**Prevent by.** In `produce-bead` _Waiting, without ending your run_, and wherever it says "heartbeat before long work": run the heartbeat as `(timeout 20 bd heartbeat <id> >/dev/null 2>&1 &)`, so a held lock costs a missed beat rather than the work. Never chain `bd …;` in front of a gate or a test run.

**Seen before.** Not in these retrospectives. A reviewer note on rq-ko6o, the same day, names the same lock.
