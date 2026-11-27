// AGT-2: a page open in the browser follows what an agent changed, without being reloaded.
import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { unregisterDom } from '../dom'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** What the studio's server and the agent need to stay Bun's own while the page has a DOM. */
const SERVERS = [
  'fetch',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'Blob',
  'File',
  'URL',
  'URLSearchParams',
  'AbortController',
  'AbortSignal',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'TextEncoder',
  'TextDecoder',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
] as const
const own = SERVERS.map(
  (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)!] as const,
)

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
for (const [name, descriptor] of own) Object.defineProperty(globalThis, name, descriptor)
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('../../src/ui/App')

// React draws inside `act`: its scheduler may be an earlier file's, whose window is gone.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BEFORE = 'a low inn under heavy snow'
const AFTER = 'a warm inn with every window lit'

describe('AGT-2: a page open in the browser follows what an agent changed', () => {
  const { url, agent } = startStudio({
    'content-studio.json': projectJson({
      images: {
        from: { part: 'tts/{part}/images.json' },
        clips: 'web/images',
        manifest: 'web/images/manifest.json',
      },
    }),
    'tts/act1/script.json': [],
    'tts/act1/images.json': [{ id: 'inn', title: 'Inn', text: BEFORE, width: 32, height: 20 }],
  })

  // The page asks for the studio's paths, as a page the studio served does.
  const real = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    real(typeof input === 'string' ? new URL(input, url) : input, init)) as typeof fetch

  const container = document.createElement('div')
  let root: ReturnType<typeof createRoot> | undefined
  afterAll(async () => {
    act(() => root?.unmount())
    await unregisterDom()
  })

  /** Waits until the open page shows `text`, in its words or in one of its fields. */
  async function shows(text: string) {
    const found = () =>
      container.textContent!.includes(text) ||
      [...container.querySelectorAll('textarea, input')].some((field) =>
        (field as HTMLInputElement).value.includes(text),
      )
    for (const giveUp = Date.now() + 10_000; !found();) {
      if (Date.now() > giveUp) {
        throw new Error(`the page never showed "${text}": ${container.textContent}`)
      }
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
    }
  }

  it('shows the new words on the page already open, without a reload', async () => {
    window.location.hash = '#/images/act1'
    document.body.append(container)
    root = createRoot(container)
    // As `src/ui/main.tsx` mounts the app.
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
    })
    act(() => root!.render(createElement(QueryClientProvider, { client }, createElement(App))))
    await shows(BEFORE)
    // Inside `act` too, so nothing the page draws meanwhile is left to that scheduler.
    await act(async () => {
      await agent.connect()
      const answer = await agent.act('PATCH', '/api/images/inn', { words: AFTER })
      expect(answer.isError).toBeUndefined()
    })

    await shows(AFTER)
    expect(container.textContent).not.toContain(BEFORE)
  }, 30_000)
})
