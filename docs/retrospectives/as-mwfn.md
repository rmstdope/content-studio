# as-mwfn — retrospective

- **Implementer:** Bishop
- **Date:** 2026-11-17
- **PR:** #572

## The fine-tuned-take test in imageTakes failed in the gate, in a file this bead did not touch

**What happened.** After rebasing onto main, `bun run check` failed one test:
`src/services/imageTakes.test.ts`, "adding a fine-tuned take > adds the next take with its picture
and what it came from, made from the image's words now". The bead changed only the Movement
panel's drawing bar (UI, CSS, its test and the architecture doc). Running that file alone three
times gave pass, pass, fail; the next full gate and CI on the PR were green.

**Why.** Not established.

**Cost.** One extra full gate (about three minutes) and three reruns of the file to tell a flake
from a regression.

**Prevent by.** A bead that pins down why "adding a fine-tuned take" sometimes finds no second take
on the board (the earlier files point at an `EACCES` rename in `takeOut`), so the test stops
failing at random in unrelated gates.

**Seen before.** as-kw3x.6, as-r0py.1.
