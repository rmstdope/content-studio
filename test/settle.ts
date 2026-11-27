/**
 * Lets pending requests, state updates and animation frames run in a component test: five turns of
 * the event loop, which is all they wait for (the fetch is faked, and a happy-dom frame is a
 * `setImmediate`). A test that needs one of a component's own timers to run out waits for that
 * time itself.
 */
export async function settle(): Promise<void> {
  // Imported here, so that loading this helper never loads React before a test file's DOM is there.
  const { act } = await import('react')
  for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 1)))
}
