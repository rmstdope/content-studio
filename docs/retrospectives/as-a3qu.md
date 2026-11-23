# as-a3qu: a DOM test green alone, red in CI

## What happened
`src/ui/agentChanges.test.tsx` rendered a hook with `GlobalRegistrator` and a faked `fetch`. It passed alone and in a local `bun run check`, and failed on three CI runs in three different ways (a count one short, a 5 s timeout, then `removeChild` errors). It also made unrelated tests after it fail.

## Why
`bun test` runs every file in one process, so the happy-dom window and React roots that other UI test files leave mounted are shared. A leaked page answered my fake `fetch` and crashed; `window` is undefined in a plain test, so TanStack's `refetchInterval` is off there too (`isServer`). Reproduced locally only with `bun test src/ui` as a whole.

## Cost
Four pushed fix attempts and about 25 minutes of CI waits.

## Prevent by
Test timers and cache logic as plain functions without a DOM (as `followAgentChanges` now is); when a DOM test must exist, reproduce with `bun test src/ui` before pushing, not the single file. A line in `docs/architecture.md`'s testing notes on the shared window would help.

## Seen before
Nothing like it yet. Also seen once: `adding a fine-tuned take` in `imageTakes.test.ts` failed in a full local run and passed alone three times.
