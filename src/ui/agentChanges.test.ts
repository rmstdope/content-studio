import { describe, expect, it } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { followAgentChanges } from './api/core'

const realFetch = globalThis.fetch

describe('an open page after an agent changed something through the MCP', () => {
  it('marks its queries to be read again when the count changed, and not before', async () => {
    let count = 0
    globalThis.fetch = (async () => Response.json({ count })) as never
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    for (const key of ['project', 'credit']) {
      await client.fetchQuery({ queryKey: [key], queryFn: async () => key, staleTime: 60_000 })
    }
    const invalidated = (key: string) => client.getQueryState([key])?.isInvalidated
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => setTimeout(r, 10))
    }
    const stop = followAgentChanges(client, 20)
    try {
      await new Promise((r) => setTimeout(r, 100))
      expect(invalidated('project')).toBe(false)

      count = 1
      await until(() => invalidated('project') === true)
      expect(invalidated('project')).toBe(true)
      // The Fish credit costs a call to Fish and only spending changes it.
      expect(invalidated('credit')).toBe(false)
    } finally {
      stop()
      client.clear()
      globalThis.fetch = realFetch
    }
  })
})
