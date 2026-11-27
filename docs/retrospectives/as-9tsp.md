# as-9tsp — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-11-27
- **PR:** #743

## A piped gate let a red commit through

**What happened.** `bun run check 2>&1 | tail -30 && git commit` committed although `tsc` failed:
the pipe's status was `tail`'s. The output showed the error; the commit was amended before the push.
**Why.** No `set -o pipefail` in the command.
**Cost.** One more full check.
**Prevent by.** `.claude/skills/produce-bead/SKILL.md`, _Building_: write that the gate is run with
`set -o pipefail` whenever its output is piped.
**Seen before.** as-2yh.

## A new system test passed five times alone and failed in the full gate

**What happened.** OVW-3's test waited for the controls it expects and `client.isFetching() === 0`,
then asked every greyed control why it was off. In one full run "Design a voice…" was still off
until the audition was read, and turned on in the middle of being asked.
**Why.** A query that has not started yet counts as nothing being fetched.
**Cost.** About ten minutes and some fifty repeat runs of the suite.
**Prevent by.** A test that waits for a rendered page to settle waits on what the page shows (here:
no control says "Wait for …"), not on `isFetching()` alone.
**Seen before.** None found.

## The command-line help test timed out in three full runs in a row

**What happened.** `bin/content-studio.test.ts`, "prints help that names the new command and file",
was killed at its own 8 s limit (exit 143) in three of 25 repeat runs, a file this bead does not
touch. The load average was about 25 when read just after.
**Why.** Not established; other sessions loading the machine is the likely reason.
**Cost.** None beyond reading it; the other 22 runs passed.
**Prevent by.** `bin/content-studio.test.ts`, `run`: give the child's kill timer the same 20 s as
the suite's time limit.
**Seen before.** as-2yh (timing failures under a loaded machine).

## CI's Test job failed in an ElevenLabs music test this diff does not touch

**What happened.** On #743 at 760dce22, `src/services/elevenMusic.test.ts`, "turns ElevenLabs’ MP3
into 16-bit WAV of its length, leaving no temporary file", failed alone (6553 pass, 1 fail). The two
lists it compared held `content-studio-eleven-*.mp3` files. Reproduced locally by running that file
while another process made and removed files of that name in the temporary folder.
**Why.** The test lists every `content-studio-eleven-*` file in the shared temporary folder before
and after, so a test file decoding a take at the same time changes the list.
**Cost.** Two red CI runs (the second on a docs-only commit) and a local reproduction.
**Prevent by.** Fixed in #743: the test decodes into a temporary folder of its own. The new test file
moved the parallel schedule, which is the likely reason it failed twice in a row here (not
established). A check against tests reading the whole temporary folder would stop the next one.
**Seen before.** None found naming this test.
