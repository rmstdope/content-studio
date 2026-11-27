# as-1j7k — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #686

## A command waited ten minutes for input that never came

**What happened.** One shell call held the edit, its proof and `bun run check`. A leftover
`cat > $TMPDIR/x` in the middle, with no input, read the call's stdin and never returned. The call
ran its 590 s timeout, moved to the background and printed nothing past that line, which read like
a slow gate until `ps` showed no test process.
**Why.** `cat` with only an output redirection reads stdin, and the tool's shell leaves stdin open.
**Cost.** About ten minutes of wall-clock.
**Prevent by.** `.claude/skills/produce-bead/SKILL.md`, _Building_: run the gate in its own call,
with `</dev/null` and its output in a file, so a stalled step before it cannot pass for a slow gate.
**Seen before.** none found

## The music spending test failed in CI on a change that only touched the stylesheet

**What happened.** CI on head 03fc4a3e failed `server, what music takes cost > lists a paid take on
the Spending page, in its act, and a free one not` (`src/server/music.test.ts:201`, `takes: 0` for
an expected 1). The file passed locally, and 30 repeats of the test too. With a temporary
`Bun.sleep(100)` at the top of `settled` in `src/services/musicTakes.ts` it failed the same way
every time.
**Why.** A take stops showing as being made once the board lists it (`split` in
`src/services/takeEngine.ts`), but its spend is saved later, in `settled`. The test waits for
`making` to empty, sleeps 20 ms and reads the Spending page, which under load is too early.
**Cost.** About ten minutes and CI run again.
**Prevent by.** A bug bead: have the test wait for the spending row instead of 20 ms, or save the
spend before the take stops showing as being made.
**Seen before.** as-evwv, as-kw3x.1

## CI failed again, on the narration spending tests

**What happened.** CI on head fefb16be, whose only new commit was this file, failed four tests in
`src/server/spending.test.ts`; the first expected `state: "error"` and read `"running"`
(line 132), and the other three followed it. The file passed locally. With a temporary
`Bun.sleep(100)` before `live.delete(id)` in `createSpendLog` (`src/services/spending.ts`) it
failed with the same four, and the test before them too.
**Why.** `end` saves the recording before it stops showing it as running, so for a moment the
Spending page lists it twice. The test's `settle` counts the saved copy as settled while the first
row is still the running one, and a failed assertion there leaves `failFrom` set for the tests
after it.
**Cost.** A second CI failure; with the head that carries this section, both of the bead's re-runs
are counted as spent.
**Prevent by.** A bug bead: leave a saved recording's id out of the running ones in
`GET /api/spending`, and reset `failFrom` in an `afterEach`.
**Seen before.** none found
