# as-uk8e — retrospective

- **Implementer:** Storm
- **Date:** 2026-11-27
- **PR:** #755

## A script mounted from the session's scratchpad did not exist inside the container

**What happened.** `docker run -v <scratchpad>:/s:ro oven/bun:1.4.2 bash /s/stress.sh`, with the
scratchpad under `/private/tmp`, ended with `bash: /s/stress.sh: No such file or directory` (exit
127). The repository, mounted from under `/Users`, was visible in the next run.

**Why.** Not established; probably the Docker VM on this Mac does not share `/private/tmp`.

**Cost.** One failed run of the load test, a few minutes.

**Prevent by.** A line in `.cerebro/traps.md`: pass a container's script on standard input
(`docker run -i … bash -s < script`) and other files in an environment variable, not as a mount of
the scratchpad.

**Seen before.** none found.
