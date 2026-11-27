// OVW-3: a greyed control says why it is off, on hover, focus or tap, and stays reachable with Tab.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, describe, expect, it } from 'bun:test'
import { createFakeEffects } from '../../src/services/effectsFake'
import { unregisterDom } from '../dom'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

// Without a key for either provider and without a sound effects model, so the studio itself has
// reasons to grey what needs one.
const { url } = startStudio(
  {
    'content-studio.json': projectJson({
      parts: [{ id: 'act1', title: 'Act I' }],
      effects: {
        from: { shared: 'tts/effects.json' },
        clips: 'audio/effects',
        manifest: 'audio/effects/manifest.json',
      },
    }),
    'content-studio/narration/cast.json': { speakers: {} },
    'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
    'tts/effects.json': [{ id: 'coins', text: 'Coins spill on stone', seconds: 3 }],
  },
  {
    fish: null,
    elevenlabs: null,
    effects: {
      ...createFakeEffects(0),
      download: () => 'absent',
      ready: () => ({ ok: false, message: 'The model is not downloaded.' }),
    },
  },
)

// The DOM is the studio's page: it comes after the server is up, and Bun's own requests and
// answers are put back, which the server in this process is built on.
const native = { fetch, Request, Response, Headers, AbortController, AbortSignal }
GlobalRegistrator.register({ url: url.href })
Object.assign(globalThis, native)
// The page's requests, as a browser sends them: to the studio, with its Origin.
globalThis.fetch = ((path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  headers.set('origin', url.origin)
  return native.fetch(new URL(path, url), { ...init, headers })
}) as typeof fetch

// React reads `window` when react-dom loads, so it is imported after.
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('../../src/ui/App')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = new QueryClient()
const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)

afterAll(async () => {
  act(() => root.unmount())
  client.clear()
  globalThis.fetch = native.fetch
  await unregisterDom()
})

/** Every control the page shows as off, however it was switched off. */
const OFF =
  '[aria-disabled="true"], button:disabled, input:disabled, select:disabled, textarea:disabled'

/** What a person reads on a control, to name it in a failure. */
const nameOf = (control: Element) =>
  control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName

/** The greyed controls on the page, each with the reason it carries. */
const greyed = () =>
  [...document.querySelectorAll<HTMLElement>(OFF)].map((control) => ({
    control,
    name: nameOf(control),
    why: control.dataset.why,
  }))

/** The reason the tip is saying, or null when no tip shows. */
const tip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null

/**
 * Opens the page at `hash`, and waits until it has read what it shows and greys each of
 * `expected` (name → reason).
 */
async function open(hash: string, expected: Record<string, string>) {
  await act(async () => {
    window.location.hash = hash
  })
  for (const giveUp = Date.now() + 10_000; ;) {
    const shown = Object.fromEntries(greyed().map(({ name, why }) => [name, why]))
    // Nothing still being read, so no control is off only until an answer arrives.
    const read = client.isFetching() === 0
    if (read && Object.entries(expected).every(([name, why]) => shown[name] === why)) return
    if (Date.now() > giveUp) throw new Error(`${hash} greys ${JSON.stringify(shown)}`)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
  }
}

/** Does `what` to the page and lets it draw what follows. */
const does = (what: () => void) => act(async () => what())

/** Puts the tip away: focus leaves, and a press lands beside every control. */
const away = () =>
  does(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
  })

/** The three ways a person asks a control why it is off. */
const WAYS: Record<string, (control: HTMLElement) => void> = {
  hover: (control) =>
    control.dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true })),
  focus: (control) => control.focus(),
  tap: (control) => control.click(),
}

/** Holds every greyed control on the page to OVW-3. */
async function holdGreyedControls() {
  for (const { control, name, why } of greyed()) {
    expect({ name, why: why || null }).toEqual({ name, why: expect.any(String) })
    for (const [way, ask] of Object.entries(WAYS)) {
      await away()
      expect({ name, way, tip: tip() }).toEqual({ name, way, tip: null })
      await does(() => ask(control))
      expect({ name, way, tip: tip() }).toEqual({ name, way, tip: why! })
    }
    // In the Tab order: not switched off for the browser, not taken out of the order or hidden,
    // it takes focus, and the studio lets Tab move on from it.
    await away()
    await does(() => control.focus())
    const tab = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    await does(() => control.dispatchEvent(tab as unknown as Event))
    expect({
      name,
      disabled: control.matches(':disabled'),
      inOrder: control.tabIndex >= 0,
      hidden: control.closest('[inert], [hidden], [aria-hidden="true"]') !== null,
      focused: document.activeElement === control,
      tabStopped: tab.defaultPrevented,
    }).toEqual({
      name,
      disabled: false,
      inOrder: true,
      hidden: false,
      focused: true,
      tabStopped: false,
    })
  }
  await away()
}

describe('a greyed control', () => {
  it('says why it is off on hover, focus and tap, and stays reachable with Tab', async () => {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(App)))
    })
    const unchanged = 'Nothing has changed yet. Change something to turn Save on.'

    await open('#/parts/act1/lines', {
      Generate: 'Nothing is left to generate here. Change the filters or the lines first.',
    })
    await holdGreyedControls()

    await open('#/characters', { 'Save pronunciations': unchanged })
    await holdGreyedControls()

    await open('#/characters/narrator', {
      'Clone a voice from recordings': 'There is no Fish Audio key. Setup says how to add it.',
      'Save style': unchanged,
    })
    await holdGreyedControls()

    // Menus too: a greyed one takes keys of its own, so Tab is most easily lost there.
    const noModel =
      'Neither sound-effects model can run on this computer. Setup says what is missing.'
    await open('#/effects/items/coins', {
      'Model for new takes': noModel,
      'Number of new takes': noModel,
    })
    await holdGreyedControls()
  })
})
