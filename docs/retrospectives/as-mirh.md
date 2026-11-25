# as-mirh

## The fine-tuned-take test in imageTakes failed once more, in a run of this bead's files

**What happened.** While I ran the four image service test files, "adding a fine-tuned take > adds
the next take with its picture and what it came from, made from the image's words now"
(`src/services/imageTakes.test.ts`) failed once. Run alone it gave fail, then pass, pass. Over
eight more runs it never failed, and the full gate and CI were green. The bead's diff does not touch
`addTake`.

**Why.** Not established, but a likely cause: the test calls `takes.make(file, 'inn', { count: 1 })`
and goes straight to `addTake` without `await settled('inn')`. Take 1 is still being made and
brought to the look in the background, and it writes the take board while `addTake` writes it, so
`board.takes[1]` can be missing. The test next to it, "copies the words and style…", does the same.

**Cost.** About five minutes of re-runs to tell a flake from a regression.

**Prevent by.** In `src/services/imageTakes.test.ts`, "adding a fine-tuned take": `await
settled('inn')` after each `make`, so `addTake` meets a finished board, unless the test means to
cover a take being made at the same moment.

**Seen before.** as-kw3x.6, as-mwfn (the same test, cause not established).
