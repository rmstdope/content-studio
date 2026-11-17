# as-l7wb — the fast gate failed on timeouts unrelated to the diff while the machine was loaded

**What happened:** the second `bun run check` (after a UI-only change to `movementRoom`) failed
with seven tests in `src/services/` (motion renderer, image and music takes, scene audio, Whisper)
over bun's 5-second timeout, with the load average above 100. The same six files passed
when run on their own, and CI passed on the same head.

**Why:** many fleet sessions were running suites at the same time on one machine. The services tests
spawn `Bun.build`, ffmpeg and workers, and under that load they take longer than the default timeout.

**Cost:** about ten minutes: one full run of roughly 200 s, a second one that hit the tool's
400-s timeout, and a run of the failing files on their own.

**Prevent by:** a check in `produce-bead` _Building_: when the fast gate fails only in files the
diff does not touch, read `uptime` and rerun those files with `bun test --timeout 60000 <files>`
before reading it as a regression. Or have `bun run check` set a longer per-test timeout for
`src/services/`.

**Seen before:** not in docs/retrospectives/.
