# as-9ymz — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-25
- **PR:** #661

## The CI wait polled a conflicting pull request for ten minutes

**What happened.** After the push answering the review, `gh pr view` said `CONFLICTING DIRTY` (main
had gained #659 and #660). The wait on `gh pr checks 661` had already been issued alongside it; it
printed "no checks reported" until the tool call timed out.
**Why.** The producer sent the mergeability check and the CI wait together instead of reading the
first before starting the second, and the wait loop treats "no checks reported" as not yet.
**Cost.** About ten minutes of waiting, then the rebase that was due at once.
**Prevent by.** In `produce-bead`, _Waiting, without ending your run_, give the CI wait loop an exit
when `gh pr view --json mergeable` reads `CONFLICTING`, so the order cannot be got wrong.
**Seen before.** none found
