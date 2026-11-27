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

## CI failed on a stop-with-the-studio test the bead does not touch

**What happened.** The `Test` job on #710 (run 45955294148) failed on one test,
`a local generator stops with the studio > stops an image take, and what it started, on SIGHUP`:
the child was still alive about a second after the studio exited. Locally,
`bun test src/services/stopWithStudio.test.ts --rerun-each=60` failed 6 of 240.
**Why.** The test gives the child 20 looks, 50 ms apart, to be gone after the studio exits. Whether
that limit or the stop itself is at fault was not established.
**Cost.** One CI run and a local repeat of the suite, a few minutes.
**Prevent by.** A bead on `src/services/stopWithStudio.test.ts` and the generators' stop path: find
whether the child outlives the studio or only dies late, then wait for its exit instead of a fixed
count of looks.
**Seen before.** none found.
