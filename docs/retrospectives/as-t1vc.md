# as-t1vc — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-11-27
- **PR:** #751

## The pull request first left out the requirements line it said it changed

**What happened.** A `perl -pi` substitution on `.cerebro/requirements.md` assumed six spaces
before `Proven by:`; the file has seven. It changed nothing and exited 0. The commit named the file
beside the new test, nothing failed, and the PR body said the requirement now named the test. The
review packet's list of changed files showed only the test.
**Why.** An in-place substitution that matches nothing succeeds, and the `git diff --stat` run
after it, which printed nothing, was not read before the commit.
**Cost.** A second commit and a second run of the fast gate, before any review or CI wait.
**Prevent by.** A step in `.claude/skills/produce-bead/SKILL.md`, _The requirements list_: after
editing the line, `git grep -n "<the test file>" .cerebro/requirements.md` must print it, in the
same command chain as the commit.
**Seen before.** none found.
