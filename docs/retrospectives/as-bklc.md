# as-bklc — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #687

## Whole-gate runs failed on unrelated tests while the machine was loaded

**What happened.** With a load average of 15 to 35, four of eight whole-suite runs (`bun run check`
or `bun test`) failed on one or two tests outside the diff, different ones each time: "server, sound
effect takes > stops a batch", "server, a scene’s mix as a sound > tells an agent fetching the mix
what it leaves out" (the 5 s timeout), "server, the spending record > logs a whole-part job" and
"adding a fine-tuned take > copies the words and style". The first run's failing test was lost,
because its output was cut with `tail`.
**Why.** Load is the likely cause; not established.
**Cost.** About ten minutes of re-runs before a review packet could be made at a gated head.
**Prevent by.** A bead that makes the server and image-take tests wait on events instead of time, or
gives them a longer timeout; and, in `produce-bead` _Building_, sending the gate's output to a file
rather than through `tail`.
**Seen before.** as-80yj, as-828w.

## `pkill -f "^sleep 30$"` was run on a shared machine

**What happened.** After a mutation check left test helpers behind, they were stopped by matching
their command line, which also matches any other session's `sleep 30` on this computer. Whether any
other process matched was not checked.
**Why.** The helpers' pid files were in temporary repositories and were not read.
**Cost.** None observed.
**Prevent by.** A line in `produce-bead` _Workspace_: stop leftover processes by pid or process
group, never by matching a command line.
**Seen before.** none found.
