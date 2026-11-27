import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { unregisterDom } from '../../../../test/dom'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { LineTakes } = await import('./LineTakes')
const { pressBlankThenEscape } = await import('../../../../test/pressBlank')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(unregisterDom)

/** Waits, re-rendering, until `ready`. */
async function until(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)))
  }
  expect(ready()).toBe(true)
}

describe('LineTakes', () => {
  it('takes the price back on Escape after a press on a spot that is not a control', async () => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ ok: false, reason: 'confirm', ceiling: 0.02 }, { status: 409 })
        : Response.json({ ok: true, takes: [] })) as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(LineTakes, {
            partId: 'act1',
            lineKey: 'a',
            draftModel: 's2.1-pro',
            playing: null,
            toggle: () => {},
          }),
        ),
      ),
    )
    const actions = () => container.querySelector<HTMLElement>('.take-actions')!
    const another = () => actions().querySelector('button')!
    // Idle, the row holds only its button and takes no focus of its own.
    expect(actions().hasAttribute('tabindex')).toBe(false)
    await act(() => another().click())
    await until(() => actions().textContent!.includes('Cancel'))
    await act(() => pressBlankThenEscape(actions()))
    expect(actions().textContent).not.toContain('Cancel')
    await until(() => document.activeElement === another())
    await act(() => root.unmount())
  })
})
