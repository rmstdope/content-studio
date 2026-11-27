# as-cuvj — retrospective

- **Implementer:** Rogue
- **Date:** 2026-11-27
- **PR:** #680

## CI timed out at 5000 ms in an image takes test the diff does not touch

**What happened.** On head `992b1f67` (the reviewed head with `main` merged in), CI failed one
test, `src/services/imageTakes.test.ts`, "the summary of a press on an act is kept by the studio >
is forgotten by closeBatch, and by takes started by hand once it has ended": `this test timed out
after 5000ms` (run 45924594345). The same diff had passed CI one run earlier, and the diff touches
only `MovementPanel.test.tsx`. Locally the test passed alone, and failed the same way (5068 ms)
when its file was run beside 90 busy loops on 18 cores: 112 pass, 1 fail.

**Why.** The test presses a whole act twice and waits for every take, so its time is real file work
under bun's default 5000 ms limit. Its neighbours in the same CI run took up to 3.9 s. Why this one
run was slow enough was not established.

**Cost.** One extra CI run (about four minutes) and a local reproduction under load.

**Prevent by.** In `src/services/imageTakes.test.ts`, give the tests that press a whole act a
longer timeout, or have them make fewer takes. A bead for it would be the navigator's call.

**Seen before.** The same kind of failure (a 5000 ms timeout in a file the diff does not touch), in
other files: as-77u, as-2tb, as-uucl.2, as-707b.
