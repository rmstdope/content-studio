import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { KeywordsEditor } = await import('./BriefEditors')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** Renders a character's keyword editor, types a keyword and presses Add. */
async function addKeyword(text: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(KeywordsEditor, { characterId: 'ada', keywords: [] }),
      ),
    ),
  )
  const field = container.querySelector<HTMLInputElement>('#keyword')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type=submit]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return { container, field, unmount: () => act(() => root.unmount()) }
}

describe('KeywordsEditor', () => {
  const realFetch = globalThis.fetch
  let page: Awaited<ReturnType<typeof addKeyword>>
  afterEach(async () => {
    globalThis.fetch = realFetch
    await page.unmount()
  })

  it('keeps the typed keyword in the field when the save is refused', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { ok: false, problems: [{ file: 'cast.json', path: 'ada', message: 'read-only folder' }] },
        { status: 409 },
      )) as unknown as typeof fetch
    page = await addKeyword('elderly male')
    expect(page.container.textContent).toContain('The keywords could not be saved')
    expect(page.container.textContent).toContain('read-only folder')
    expect(page.field.value).toBe('elderly male')
  })

  it('keeps the typed keyword when Add is pressed again while the save is under way', async () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch
    page = await addKeyword('elderly male')
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('button[type=submit]')!.click()
    })
    expect(page.field.value).toBe('elderly male')
  })

  it('clears the field when the save works', async () => {
    globalThis.fetch = (async () => Response.json({ ok: true })) as unknown as typeof fetch
    page = await addKeyword('elderly male')
    expect(page.field.value).toBe('')
  })
})
