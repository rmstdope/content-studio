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
