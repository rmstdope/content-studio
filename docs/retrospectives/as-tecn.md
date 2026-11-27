# as-tecn — retrospective

- **Implementer:** Rogue
- **Date:** 2026-11-27
- **PR:** #753

## `git push` reported the branch rejected, though the commit was on the branch

**What happened.** The second push of the branch, a bare `git push -q` after a commit, printed
`! [remote rejected] … (cannot lock ref 'refs/heads/as-tecn-…': is at 4a79965b… but expected
121cd86e…)` and `error: failed to push some refs`. 4a79965b was the very commit being pushed.
`git fetch` and `gh pr view 753` then showed the remote branch and the PR head at it.
**Why.** Not established. The message says the ref had already moved to that commit when the push
tried to move it; what moved it was not found (`.beads/hooks/pre-push` runs only beads' own step,
and was not traced further).
**Cost.** A few minutes confirming what the remote held.
**Prevent by.** In `produce-bead`, _Building_: after a rejected push, compare
`gh pr view <n> --json headRefOid` with `git rev-parse HEAD` before retrying or rebasing.
**Seen before.** none found
