# as-bt1m.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-26
- **PR:** #669

## The local gate failed by the hundred while the Mac slept

**What happened.** The second `bun run check` of the bead, after a change to tests and a comment
only, ran past its 500 s tool timeout and ended with 983 failed tests: UI tests that never became
ready, and single tests reported as taking up to 1071 s. `pmset -g log` showed the Mac asleep on
battery, woken by its lid. A rerun under `caffeinate -i` was interrupted by another sleep (2
failures of 97 s and 167 s). A third failed one test, `src/server/sceneMix.test.ts` "tells an
agent fetching the mix…", at its 5000 ms limit with the load average above 10; its file passes 4
of 4 with `--timeout 60000`. Run alone with `-t`, that test fails with a 409, because it needs the
tests before it in the file. CI passed the same code.

**Why.** The sleep: the lid closed during the run, which `caffeinate` did not prevent. The single
timeout: most likely load from other builds on the machine; not established beyond that.

**Cost.** Three extra full runs of the gate, about twenty minutes.

**Prevent by.** `.claude/skills/produce-bead/SKILL.md`, _Building_: when a local gate fails with
test durations of minutes, read `pmset -g log` for a sleep before reading any failure.
`src/server/sceneMix.test.ts`: give the agent test a longer timeout, and let it set up its own
state so that it can be run alone.

**Seen before.** None found for the sleep (`grep -rli sleep docs/retrospectives/`).
