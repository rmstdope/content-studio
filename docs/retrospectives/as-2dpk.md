# as-2dpk — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-11-27
- **PR:** #685

## A test file well within its time limit locally missed it in CI

**What happened.** `bun test src/services/imagePatchGame.test.ts` took 1.6 to 2.0 s locally after the
change (10.8 s before), against an acceptance of under 6 s in the CI log. The first CI run (job 140276955078) took 6.02 s from the file's group header to its last test. It passed only after
as-w523 (PR #684) merged and the branch caught up: 2.39 s (job 140289544874).

**Why.** The CI figure counts the whole group, the `beforeAll` included (about 1.7 s there, 0.4 s
locally), and the runner was about 3.6 times slower than this machine on this file. The plan judged
the target from the local time alone. What remained was largely pixel work, which as-w523 made
cheaper.

**Cost.** About half an hour waiting for another bead's pull request, and a second CI run.

**Prevent by.** `.claude/skills/produce-bead/SKILL.md`, _The plan_, _Validation_: where the
acceptance is a CI duration, scale the local measure by the same file's CI-to-local ratio before
the change, and name any open bead that touches the same cost.

**Seen before.** None found.
