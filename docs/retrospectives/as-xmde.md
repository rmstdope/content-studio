# as-xmde — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-27
- **PR:** #677

## The gate failed four runs on a different timing-sensitive test each time

**What happened.** `bun run check` failed four times with one or two failures, each run on other
tests: "goes on while takes are started by hand during the press, and a new press replaces it"
(`services/musicTakes.test.ts`), "adding a fine-tuned take > adds the next take with its picture
and what it came from" (`services/imageTakes.test.ts`, twice), "takes of a declared patch > saves
the take with its area" (`services/imagePatches.test.ts`, `look` read "old" for "ready") and
"server, the spending record > logs a whole-part job, and shows it live while it runs". The ones
rerun alone passed (the fine-tuned one failed once in four). `uptime` read load averages from 10
to 33.

**Why.** For the fine-tuned test, from reading it: it calls `view` once after `make` and then
`addTake` without waiting for the first take to reach the board, so under load the second can be
looked for before both are there. The others: not established.

**Cost.** Four extra full gates, about four to five minutes each, and the reruns that told each
failure from the change.

**Prevent by.** A bead that gives these four tests a deterministic wait: in
`services/imageTakes.test.ts`, "adds the next take with its picture" should await the file's
`settled('inn')` before `addTake`; the other three need their race established first.

**Seen before.** as-80yj (and through it as-mirh, which tracks the fine-tuned-take test), as-kw3x.6, as-mwfn, as-77u, as-2tb (named by as-77u), as-uk15, as-707b, as-911b.
