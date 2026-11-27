# as-mp9g — retrospective

## Running the test files in parallel failed one run in two until the tests' own timing was fixed

**What happened.** The bead expected one suspect test. `bun test --parallel` over the whole suite
then failed in a good share of runs, with a different test most times: an unhandled "window is not
defined" after a component test file ended, `settled` helpers that returned before the take's job
was over, 5 ms and 150 ms sleeps, a fake take slow enough to be timed, and a 500 ms time limit.
Two of the failures were races in the product (as-uv93, as-frzh). A rebase onto a main eight
commits newer brought three more component test files and further flakes.

**Why.** The tests wait for a fixed time, or for what a view shows, which is a moment earlier than
what the next step needs. One file at a time on an idle machine rarely lost those races.

**Cost.** Some twenty full-suite stress rounds, about two hours, for a change whose planned part is
a few lines of CI configuration.

**Prevent by.** In `test/`, one helper that waits for a condition with a generous limit, and a test
that refuses a new fixed `setTimeout` wait in `src/**/*.test.ts` (many remain). A new `settled`
helper for takes should also wait for `takesUnderWay` (`test/helpers.ts`) or the service's
`making`.

**Seen before.** as-828w, as-bklc, as-xmde, as-mwfn, as-cuvj, as-80yj, as-jkm2 (timing failures in
the gate or CI under load).
