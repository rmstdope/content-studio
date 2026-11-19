import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { CleanUp } = await import('./CleanUp')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())

/** An audio element that only notes what it was told: which clips play, muted or not, and where. */
class FakeAudio {
  static made: FakeAudio[] = []
  loop = false
  muted = false
  paused = true
  currentTime = 0
  duration = 7
  listeners = new Map<string, () => void>()
  constructor(readonly src: string) {
    FakeAudio.made.push(this)
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

const line = (key: string, text: string) => ({
  key,
  speaker: 'keeper',
  text,
  cue: '',
  status: 'ok',
  file: `${key}.mp3`,
})

/** What the studio answers; `copy` decides what asking for a cleaned copy gets, `save` the switch. */
function studio(options: {
  lines?: ReturnType<typeof line>[]
  copy?: () => Promise<Response>
  save?: () => Response
}) {
  const calls: { path: string; method: string; body: unknown }[] = []
  const fetcher = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path.startsWith('/api/parts/act1')) {
      return Response.json({ ok: true, part: { lines: options.lines ?? [] } })
    }
    if (path.startsWith('/api/characters/keeper') && method === 'PATCH') {
      return options.save?.() ?? Response.json({ ok: true })
    }
    if (path.startsWith('/api/cleaned') && method === 'POST') {
      return options.copy?.() ?? Response.json({ ok: true, name: 'a'.repeat(16) + '.mp3' })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

const lines = [line('a', 'You climbed all those stairs for this?'), line('b', 'Welcome.')]

describe('CleanUp', () => {
  const realFetch = globalThis.fetch
  const realAudio = (globalThis as { Audio?: unknown }).Audio
  beforeEach(() => {
    FakeAudio.made = []
    ;(globalThis as { Audio?: unknown }).Audio = FakeAudio
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    ;(globalThis as { Audio?: unknown }).Audio = realAudio
    document.body.innerHTML = ''
  })

  async function show(
    answers: ReturnType<typeof studio>,
    props: { clean?: boolean; takeKey?: string | null; language?: string } = {},
  ) {
    globalThis.fetch = answers.fetcher
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const render = (language?: string) =>
      act(() =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(CleanUp, {
              key: language ?? '',
              characterId: 'keeper',
              language,
              clean: props.clean ?? false,
              takeKey: props.takeKey === undefined ? 'c'.repeat(16) : props.takeKey,
              parts: [{ id: 'act1', title: 'Act I' }],
              speaker: 'keeper',
            }),
          ),
        ),
      )
    await render(props.language)
    const settle = async (ready: () => boolean) => {
      for (let i = 0; i < 100 && !ready(); i++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
      }
      expect(ready()).toBe(true)
    }
    const text = () => container.textContent ?? ''
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === name || b.getAttribute('aria-label') === name,
      )!
    const menu = () => container.querySelector('select')!
    return { container, render, settle, text, button, menu }
  }

  it('offers the take, then each recorded line, opening on the first line, as recorded', async () => {
    const page = await show(studio({ lines }))
    await page.settle(() => page.menu().options.length === 3)
    expect([...page.menu().options].map((o) => o.textContent)).toEqual([
      'The take (the audition phrase)',
      'Act I · “You climbed all those stairs for this?”',
      'Act I · “Welcome.”',
    ])
    expect(page.menu().value).toBe('act1/a')
    expect(page.menu().title).toContain('You climbed all those stairs')
    expect(page.button('As recorded').getAttribute('aria-pressed')).toBe('true')
    expect(page.text()).toContain('Hear it on')
    expect(page.text()).toContain(
      'Lowers the background noise in the pauses of every line recorded from now on. Lines already recorded stay as they are.',
    )
  })

  it('shows the on hint when the voice is switched on', async () => {
    const page = await show(studio({ lines }), { clean: true })
    expect(page.text()).toContain('Every line recorded from now on has the background noise')
    const flip = page.container.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(flip.checked).toBe(true)
  })

  it('saves the switch the moment it is flipped, for the language shown', async () => {
    const answers = studio({ lines })
    const page = await show(answers, { language: 'sv' })
    const flip = page.container.querySelector<HTMLInputElement>('input[role="switch"]')!
    await act(() => flip.click())
    await page.settle(() => answers.calls.some((c) => c.method === 'PATCH'))
    expect(answers.calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/api/characters/keeper?language=sv',
      body: { clean: true },
    })
  })

  it('puts the switch back and says why when it cannot be saved', async () => {
    const answers = studio({
      lines,
      save: () =>
        Response.json(
          { ok: false, problems: [{ file: 'cast.json', path: '', message: 'read-only' }] },
          { status: 409 },
        ),
    })
    const page = await show(answers)
    const flip = page.container.querySelector<HTMLInputElement>('input[role="switch"]')!
    await act(() => flip.click())
    await page.settle(() => page.text().includes('Couldn’t save the clean-up: read-only'))
    expect(flip.checked).toBe(false)
  })

  it('loops the line as recorded, then brings in the cleaned copy and flips without starting over', async () => {
    const answers = studio({ lines })
    const page = await show(answers)
    await page.settle(() => page.menu().options.length === 3)
    await act(() => page.button('Play').click())
    await page.settle(() => FakeAudio.made.length === 2)
    const [recorded, cleaned] = FakeAudio.made as [FakeAudio, FakeAudio]
    expect(recorded.src).toBe('/api/parts/act1/clips/a.mp3')
    expect(cleaned.src).toBe(`/api/cleaned/${'a'.repeat(16)}.mp3`)
    expect([recorded.loop, cleaned.loop]).toEqual([true, true])
    expect([recorded.muted, cleaned.muted]).toEqual([false, true])
    expect(answers.calls.find((c) => c.path.startsWith('/api/cleaned'))?.body).toEqual({
      part: 'act1',
      file: 'a.mp3',
    })

    recorded.currentTime = 3.4
    await act(() => recorded.listeners.get('timeupdate')?.())
    expect(page.text()).toContain('0:03 / 0:07 · looping')

    await act(() => page.button('Cleaned').click())
    expect([recorded.muted, cleaned.muted]).toEqual([true, false])
    expect(cleaned.currentTime).toBe(3.4)
    expect(page.button('Cleaned').getAttribute('aria-pressed')).toBe('true')
    // Clicking the half already lit flips back too.
    await act(() => page.button('Cleaned').click())
    expect([recorded.muted, cleaned.muted]).toEqual([false, true])
    expect(FakeAudio.made).toHaveLength(2)

    await act(() => page.button('Stop').click())
    expect([recorded.paused, cleaned.paused]).toEqual([true, true])
  })

  it('plays as recorded and says Cleaning… while the cleaned copy is made', async () => {
    let finish!: (response: Response) => void
    const answers = studio({
      lines,
      copy: () => new Promise<Response>((resolve) => (finish = resolve)),
    })
    const page = await show(answers)
    await page.settle(() => page.menu().options.length === 3)
    await act(() => page.button('Play').click())
    await page.settle(() => page.text().includes('Cleaning…'))
    expect(FakeAudio.made).toHaveLength(1)
    expect(page.button('Cleaned').getAttribute('aria-disabled')).toBe('true')
    await act(() => page.button('Cleaned').click())
    expect(page.button('As recorded').getAttribute('aria-pressed')).toBe('true')
    await act(async () => finish(Response.json({ ok: true, name: 'b'.repeat(16) + '.mp3' })))
    await page.settle(() => FakeAudio.made.length === 2)
    expect(page.text()).not.toContain('Cleaning…')
    expect(page.button('Cleaned').getAttribute('aria-disabled')).toBeNull()
  })

  it('keeps playing as recorded and says why when the cleaned copy cannot be made', async () => {
    const answers = studio({
      lines,
      copy: async () =>
        Response.json({ ok: false, message: 'ffmpeg could not clean the voice: boom' }),
    })
    const page = await show(answers)
    await page.settle(() => page.menu().options.length === 3)
    await act(() => page.button('Play').click())
    await page.settle(() =>
      page
        .text()
        .includes('The cleaned version couldn’t be made: ffmpeg could not clean the voice: boom'),
    )
    expect(FakeAudio.made).toHaveLength(1)
    expect(FakeAudio.made[0]!.muted).toBe(false)
    expect(page.button('Cleaned').getAttribute('aria-disabled')).toBe('true')
    // The switch still works.
    const flip = page.container.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(flip.disabled).toBe(false)
  })

  it('stops the loop for another line, and starts again as recorded', async () => {
    const page = await show(studio({ lines }))
    await page.settle(() => page.menu().options.length === 3)
    await act(() => page.button('Play').click())
    await page.settle(() => FakeAudio.made.length === 2)
    await act(() => page.button('Cleaned').click())
    await act(() => {
      page.menu().value = 'act1/b'
      page.menu().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(FakeAudio.made.every((a) => a.paused)).toBe(true)
    expect(page.button('Play')).toBeDefined()
    expect(page.button('As recorded').getAttribute('aria-pressed')).toBe('true')
  })

  it('stops the loop when the language changes, and when the page is left', async () => {
    const page = await show(studio({ lines }))
    await page.settle(() => page.menu().options.length === 3)
    await act(() => page.button('Play').click())
    await page.settle(() => FakeAudio.made.length === 2)
    await page.render('sv')
    expect(FakeAudio.made.every((a) => a.paused)).toBe(true)
  })

  it('has only the take to hear when no line is recorded, and compares on it', async () => {
    const page = await show(studio({ lines: [] }))
    await page.settle(() => page.text().includes('Hear it on'))
    expect([...page.menu().options].map((o) => o.textContent)).toEqual([
      'The take (the audition phrase)',
    ])
    await act(() => page.button('Play').click())
    await page.settle(() => FakeAudio.made.length === 2)
    expect(FakeAudio.made[0]!.src).toBe(`/api/takes/${'c'.repeat(16)}.mp3`)
  })

  it('dims play and the flip, saying so, while the take is not made', async () => {
    const page = await show(studio({ lines: [] }), { takeKey: null })
    expect(page.text()).toContain('Wait for the take to be made.')
    expect(page.button('Play').getAttribute('aria-disabled')).toBe('true')
    expect(page.button('Cleaned').getAttribute('aria-disabled')).toBe('true')
    const flip = page.container.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(flip.disabled).toBe(false)
  })
})
