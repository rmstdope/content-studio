# as-4yfu — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-11-27
- **PR:** #679

## The review packet was too large to paste into the reviewer's prompt

**What happened.** `review-packet as-4yfu 679` printed 91,656 bytes. `produce-bead`, _The review
loop_, says to paste its output whole into the sub-agent's prompt. I did not retype it: the prompt
named the file and told the reviewer to read it all.

**Why.** A producer can only paste by writing the text out again as its own output, which for a
diff of 45 files is long and open to copying errors. The packet has no other way into a prompt.

**Cost.** No time lost; a rule not followed as written.

**Prevent by.** `produce-bead`, _The review loop_: say that the prompt may name the packet's file,
unedited, instead of pasting it, at least above a size.

**Seen before.** None found.
