# as-6gbe — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-11-27
- **PR:** #710

## Beads built side by side each created the shared system-test start-up

**What happened.** The bead said that if no other system test existed yet, it should bring the
small shared start-up. None existed when the work began, so `test/system/studio.ts` was written.
By the end of the review `origin/main` carried its own `test/system/studio.ts` (arriving with the
RUN-2 and AGT-1 system tests, #707 and #708), and the rebase hit an add/add conflict there and one
in `docs/architecture.md` §11.
**Why.** Several testing beads, each carrying the same "bring it if it is not there" sentence, were
in flight together, and nothing made one wait for another.
**Cost.** One aborted rebase, the test rewritten onto the other start-up's API, the gate and the
mutation checks run again.
**Prevent by.** When Sage files a family of testing beads that share new groundwork
(`.cerebro/cerebro/agents/qa.md`, filing), make the groundwork its own bead and have the others
depend on it.
**Seen before.** none found.

## The full test run failed on unrelated tests after the rebase

**What happened.** After the rebase `bun run check` failed with one test, and of six further
`bun run test` runs two failed, each with one test: `content-studio without a project file > says
so when there is no project file` (after 8 s) and `the image patch routes > makes takes of a
declared patch, serves their pictures, chooses one, drops another`. The first failure's name was
not captured. The other runs passed, and neither named test is touched by this bead.
**Why.** not established.
**Cost.** Seven extra full runs, a few minutes.
**Prevent by.** A testing bead for each of the two names: make the wait in each depend on the
state it waits for rather than on elapsed time, once the cause is found.
**Seen before.** as-i10j (a closed bug: a different timing failure among the image patch tests).
