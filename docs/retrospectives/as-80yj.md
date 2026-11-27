# as-80yj

## Image service and server tests failed on timing while the machine was loaded

**What happened.** With a load average of 12 to 22, three of six full local runs failed, each on one
or two tests, and the runs between them passed: "adding a fine-tuned take > adds the next take with
its picture…" (`src/services/imageTakes.test.ts`), "takes of a declared patch > saves the take with
its area and the words it was made from" (`src/services/imagePatches.test.ts`, `look: 'old'` where
`'ready'` was expected) and once "tells an agent fetching the mix what it leaves out" (the 5 s test
timeout). The two image tests also failed on unchanged `main` (37317c11) in a clone.

**Why.** The first is as-mirh's. For the patch test, not established; a likely cause: the take is on
the board before `bringing` marks it, so the test's `settled` can return between the two and read the
take as `old`. The timeout is the default 5 s on a loaded machine.

**Cost.** About twenty-five minutes of full re-runs and a clone of `main` to tell flakes from a
regression.

**Prevent by.** In `src/services/imagePatches.ts` (`run`), check whether `bringing` is set only after
the board lists the take, and set it in `save`'s `written` if so; in
`src/services/imageTakes.test.ts`, as-mirh's `await settled('inn')`.

**Seen before.** as-mirh, as-mwfn, as-kw3x.6 (the fine-tuned-take test).
