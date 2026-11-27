# as-0zbw — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-27
- **PR:** #730

## CI failed on an unrelated narration test that had already turned main red the same day

**What happened.** The Test job on this pull request failed on `src/services/narration.test.ts`,
"recordLine > records a line asked for twice at once only once": expected 1 request, received 2
(run 45991109080). Main had failed on the same assertion at 11:14 the same day (run 45988727701).
The diff does not touch narration. Locally, `bun test ./src/services/narration.test.ts -t "asked
for twice at once" --rerun-each 20000` in an `oven/bun:1.4.2` container with 16 busy loops failed
444 times; 4000 runs on the Mac passed.

**Why.** The failure rate is established, the cause only from reading the code: `recordLine` (`src/services/narration.ts`)
reads the part and makes the speaker before it looks for a recording of the same line in flight. A
second call whose reads are slower than the whole first recording, instant with the test's fake,
finds none and records again.

**Cost.** One extra CI cycle and about ten minutes.

**Prevent by.** A Testing bead for that test: hold the fake's first request open until the second
call has joined it, or move the look-up in `recordLine` ahead of its awaits if the second request
is judged a defect.

**Seen before.** none found.
