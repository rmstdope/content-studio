# as-fuaz — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-11-27
- **PR:** #718

## The same-size tests passed while the three tabs drew a picture at different widths

**What happened.** The tests of as-5068 hold Fine-tune, Patches and Named areas to one size, and
were green while Chrome showed 590.9, 593.2 and 531.9 + bar for one take at 1512x806.
**Why.** Their fixtures give the image exactly the take's shape. A model's take is a few rows taller
than the image (816x1024 for 160x200), so only real takes split the shapes. The bead's description
named the Patches panel's box, which explains the narrow window only.
**Cost.** A headless Chrome measurement before the plan could be written.
**Prevent by.** A size or crop test of an image uses a take whose shape differs from the image's,
as `SAME_SIZE` in `test/pictureSize.ts` now does in its last entry.
**Seen before.** none found.

## A refresh test failed once in the full gate

**What happened.** `bun run check` failed in `src/services/refresh.test.ts`, "says while a part is
refreshing, and stops every refresh when the studio stops": the refresh answered `ok: true` with
`sh: line 1: 1938 Killed: 9 sleep 30` instead of failing. The file alone passed (31 of 31), and so
did the next full gate, with no change to it.
**Why.** Not established. The output reads as if the `sleep` was killed before the shell, which
then ended well.
**Cost.** One extra gate run.
**Prevent by.** A bead against that test or the order `stopAll` kills a command's processes in.
**Seen before.** none found.
