import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider, useQuery } = await import('@tanstack/react-query')
const { useAgentChanges } = await import('./api/core')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

const realFetch = globalThis.fetch

describe('an open page after an agent changed something through the MCP', () => {
  it('reads its queries again when the count changed, and not before', async () => {
    let count = 0
    let projectReads = 0
    let creditReads = 0
    const fake = (async (url: string) =>
      Response.json(
        url === '/api/agent-changes'
          ? { count }
          : url === '/api/credit'
            ? { reads: ++creditReads }
            : { reads: ++projectReads },
      )) as unknown as typeof fetch
    globalThis.fetch = fake
    window.fetch = fake

    function Page() {
      useAgentChanges(10)
      useQuery({
        queryKey: ['project'],
        queryFn: async () => (await fetch('/api/project')).json(),
      })
      // The Fish credit is asked for at most every five minutes, since each read calls Fish.
      useQuery({
        queryKey: ['credit'],
        queryFn: async () => (await fetch('/api/credit')).json(),
        staleTime: 5 * 60_000,
      })
      return null
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, networkMode: 'always' } },
    })
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    const wait = (ms: number) =>
      act(async () => {
        await new Promise((r) => setTimeout(r, ms))
      })
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(Page)))
    })
    await wait(100)
    expect(projectReads).toBe(1)

    count = 1
    await wait(100)
    expect(projectReads).toBe(2)
    expect(creditReads).toBe(1)

    await wait(100)
    expect(projectReads).toBe(2)

    await act(async () => root.unmount())
    client.clear()
    globalThis.fetch = realFetch
    window.fetch = realFetch
  })
})
