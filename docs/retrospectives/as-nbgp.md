# as-nbgp — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #746

## A fake Whisper worker from another tree ran for six hours at high CPU while the gate was timing out

**What happened.** `bun run check` failed on `bin/content-studio.test.ts` "prints help that names
the new command and file" (the child was killed at its 8 s limit; `--help` alone takes 0.05 s). It
passed on its own and in the next full run. `uptime` read load averages of 25 to 29. `ps -r` showed,
near the top, `bun .cerebro/worktrees/as-b2o8/test/fixtures/fake-whisper.ts`: pid 60754, parent 1,
up 6 h 22 min, between 59 % and 78 % CPU. as-b2o8 was already closed and verified.

**Why.** Not established. The parent of 1 says the process that started it ended without stopping
it. The fixture awaits forever for `hang.wav`, which is the case that could leave one behind, but
that this process had been sent `hang` was not checked. The load timeout itself is the one earlier
retrospectives record; how much of the load this process was is not established.

**Cost.** One extra full run of the gate and a few minutes. The process still ran when this was
written; it belongs to no running pass and was not killed.

**Prevent by.** `test/fixtures/fake-whisper.ts`: exit when standard input closes or the parent is
gone, including while a `hang` request is pending, so a test run that is killed leaves no worker.

**Seen before.** None found for the stray process. Load timeouts: as-l7wb, as-bklc, as-707b and
others.
