# Test architecture

Agreed with the navigator 2026-11-27.

## Unit             src/core/*.test.ts, src/ui/*.test.ts
  Belongs here:    pure decisions: schemas, the fingerprint, the planner, text rules, what a page says for a given state
  Not here:        disk, network, audio, processes, the clock, a DOM
  Enough is:       every branch of a decision once

## Service          src/services/*.test.ts
  Belongs here:    what the studio reads and writes in a game, against a temporary repository (tempRepo), with fakes for Fish Audio, ElevenLabs, Whisper and the local models; the ffmpeg and picture adapters on small real files
  Not here:        the cases of a decision core already makes, a real game, a live provider (opt-in only), waits on the real clock
  Enough is:       each operation once written and once refused; each adapter's own behaviour once

## Server           src/server/**/*.test.ts
  Belongs here:    what a route or an MCP step adds of its own: the address and Origin checks, the body it accepts, the status it answers, which service it reaches
  Not here:        the cases of a rule core or a service already proves, asserted again through the route
  Enough is:       each route once accepted, and once refused for each refusal it adds of its
                   own (the refusal of another page is proven for every route by
                   test/system/SAF-2.test.ts, never listed again here); each MCP step once

## Component        src/ui/**/*.test.tsx
  Belongs here:    what a page or panel shows and does on a click or a key, rendered in happy-dom with the server's answers stubbed
  Not here:        a running server, waits on the real clock, every case of a rule a pure helper already decides
  Enough is:       each state of a control once, each thing a person can do on the page once

## System           test/system/<ID>.test.ts
  Belongs here:    one requirement each, named by its ID: the studio started for real on a temporary game, with the providers and models faked, and driven as a person or an agent drives it (its pages' requests, the real page rendered in happy-dom, or MCP)
  Not here:        the branches of a rule, a page's layout, a live provider
  Enough is:       every requirement once
