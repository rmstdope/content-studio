# as-nd22 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-11-27
- **PR:** #747

## The local gate failed on a CLI test's own 8-second kill timer under load

**What happened.** `bun run check`, run again after the review, failed one test:
`bin/content-studio.test.ts`, "prints help that names the new command and file", exit code 143
after 8009 ms. The diff does not touch it. Running that file alone with bun's default per-test
timeout then still had a failure; with `--timeout=20000` it passed 5 of 5 in 20 s, and the next full
gate passed. `uptime` read a load average of about 21.

**Why.** `run` in that file kills the command after 8000 ms, which gives 143. That the load made the
command slower than that is likely, not established.

**Cost.** One extra full run of the gate, a few minutes.

**Prevent by.** `bin/content-studio.test.ts`, `run`: raise the kill timer to just under the gate's
20 s per-test timeout, so a slow machine does not fail a command that would have finished.

**Seen before.** as-707b, as-2yh (other tests timing out while the machine was loaded).
