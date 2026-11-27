import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * How many turns of the event loop a scheduled render gets before the DOM goes: one runs the
 * timer that tells React, one what React's scheduler then queues, and the rest are spare.
 */
const TURNS = 5

/**
 * Takes down the DOM a test file registered, after what is already due has run. React reads
 * `window` when it renders, and a file's last test can leave a render scheduled (TanStack Query
 * tells its observers from a timer): run without a window, it fails the whole run as an unhandled
 * error between tests.
 */
export async function unregisterDom(): Promise<void> {
  for (let turn = 0; turn < TURNS; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setImmediate(resolve))
  }
  await GlobalRegistrator.unregister()
}
