# as-evwv

## A check I did not read went to the PR red

**What happened:** I ran `bun run check` in the background and read only `tail` of its log, which printed the test counts and not the exit code; it had one failure (`renderPatchGame` returned an error when a board read raced the engine's write). I pushed and reviewed on that head. Later CI also failed on a second cause of my own: `workOf` read all patch boards before the takes being made, so a take that landed in between showed as neither made nor making (passed locally, failed on a slower runner).

**Why:** the exit code was not part of what I looked at; the ordering rule ("entries first, then the board", a comment in `workOf`) was lost when I hoisted the board reads out of the loop.

**Cost:** two extra pushes and one CI cycle.

**Prevent by:** run the gate with its exit code in the same call (`bun run check; echo "exit $?"`) and read that line, never a `tail` alone.

**Seen before:** nothing like it yet.
