# as-8e1z.2 — two sibling beads created the same file

**What happened:** as-8e1z.2 and as-8e1z.5 were built at the same time and each created `src/server/mcpActions.ts` and the `studio_act` tool in `mcp.ts`. .5 merged first; this PR became CONFLICTING/DIRTY after CI had passed, and the rebase conflicted in six files, so the change was laid again on .5's layout (one registry file per area).

**Why:** the epic's children were declared independent, but as-8e1z.1's design only promised the read tools; neither plan named who creates the shared registry and the write tool.

**Cost:** one rebuild of the diff, one more full check run and one more CI cycle (~15 minutes).

**Prevent by:** the epic's first write child (or the read child) creating the shared registry and `studio_act` before the area children start, or each area plan naming its own registry file.

**Seen before:** nothing like it yet.
