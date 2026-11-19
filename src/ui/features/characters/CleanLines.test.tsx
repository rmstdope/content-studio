import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { CleanUp } = await import('./CleanUp')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  await GlobalRegistrator.unregister()
})

/** An audio element that only notes which clips it was given. */
class FakeAudio {
  static made: FakeAudio[] = []
  loop = false
  muted = false
  paused = true
  currentTime = 0
  duration = 7
  constructor(readonly src: string) {
    FakeAudio.made.push(this)
  }
  addEventListener() {}
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

type Job = {
  kind: 'clean' | 'putback'
  total: number
  done: number
  failed: { part: string; key: string; message: string }[]
  status: 'running' | 'stopping' | 'done' | 'stopped'
}
type Counts = {
  total: number
  cleaned: number
  problem?: string | null
  cleanedFiles?: { part: string; file: string }[]
  job?: Job | null
}

const line = (key: string, text: string) => ({
  key,
  speaker: 'keeper',
  text,
  cue: '',
  status: 'ok',
  file: `${key}.mp3`,
})

/** What the studio answers: the voice's lines in the game as `counts`, and a note of every write. */
function studio(counts: Counts) {
  const calls: { path: string; method: string; body: unknown }[] = []
  const fetcher = (async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path.startsWith('/api/parts/act1')) {
      return Response.json({
        ok: true,
        part: { lines: [line('a', 'You climbed all those stairs for this?')] },
      })
    }
    if (path.startsWith('/api/characters/keeper/cleaned-lines') && method === 'GET') {
      return Response.json({
        cleanedFiles: [],
        job: null,
        problem: null,
        levels: [],
        levelJob: null,
        ...counts,
      })
    }
    if (path.startsWith('/api/characters/keeper/cleaned-lines')) return Response.json({})
    if (path.startsWith('/api/characters/keeper') && method === 'PATCH') {
      return Response.json({ ok: true })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

describe('CleanLines', () => {
  const realFetch = globalThis.fetch
  const realAudio = (globalThis as { Audio?: unknown }).Audio
  beforeEach(() => {
    FakeAudio.made = []
    ;(globalThis as { Audio?: unknown }).Audio = FakeAudio
  })
  const roots: { unmount: () => void }[] = []
  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()))
    globalThis.fetch = realFetch
    ;(globalThis as { Audio?: unknown }).Audio = realAudio
    document.body.innerHTML = ''
  })

  async function show(counts: Counts, { clean = true }: { clean?: boolean } = {}) {
    const asking: boolean[] = []
    const answers = studio(counts)
    globalThis.fetch = answers.fetcher
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(() =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(CleanUp, {
            characterId: 'keeper',
            clean,
            level: 100,
            takeKey: 'c'.repeat(16),
            parts: [{ id: 'act1', title: 'Act I' }],
            speaker: 'keeper',
            onAskingOff: (open: boolean) => asking.push(open),
          }),
        ),
      ),
    )
    const settle = async (ready: () => boolean) => {
      for (let i = 0; i < 100 && !ready(); i++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
      }
      expect(ready()).toBe(true)
    }
    const text = () => container.textContent ?? ''
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === name) ?? null
    const flip = () => container.querySelector<HTMLInputElement>('input[role="switch"]')!
    const writes = () => answers.calls.filter((c) => c.method !== 'GET')
    return { ...answers, asking, container, settle, text, button, flip, writes }
  }

  it('says how many lines are not cleaned, with the button, while the voice is on', async () => {
    const page = await show({ total: 38, cleaned: 12 })
    await page.settle(() => page.text().includes('26 of 38 lines in the game aren’t cleaned yet.'))
    expect(page.button('Clean 26 lines…')).not.toBeNull()
  })

  it('says nothing about the lines when there are none in the game, and no button when all are cleaned', async () => {
    const none = await show({ total: 0, cleaned: 0 })
    await none.settle(() => none.calls.some((c) => c.path.includes('cleaned-lines')))
    expect(none.text()).not.toContain('in the game')
    const all = await show({ total: 38, cleaned: 38 })
    await all.settle(() => all.text().includes('All 38 lines in the game are cleaned.'))
    expect(all.container.querySelector('.clean-count button')).toBeNull()
  })

  it('says the record cannot be read instead of offering to clean', async () => {
    const page = await show({ total: 38, cleaned: 0, problem: 'act1.cleaned.json: not valid JSON' })
    await page.settle(() => page.text().includes('The record of cleaned lines can’t be read'))
    expect(page.button('Clean 38 lines…')).toBeNull()
  })

  it('asks before cleaning, with focus on the confirming button; Escape brings the count back and writes nothing', async () => {
    const page = await show({ total: 38, cleaned: 12 })
    await page.settle(() => page.button('Clean 26 lines…') !== null)
    await act(() => page.button('Clean 26 lines…')!.click())
    expect(page.text()).toContain('Clean 26 lines already in the game?')
    expect(page.text()).toContain('Their pauses get the same clean-up as new lines.')
    expect(page.text()).toContain(
      'The originals are kept. Switching the clean-up off puts them back.',
    )
    expect(document.activeElement).toBe(page.button('Clean 26 lines'))
    const ask = page.container.querySelector('.clean-ask')!
    await act(() => {
      ask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(page.text()).toContain('26 of 38 lines in the game aren’t cleaned yet.')
    expect(document.activeElement).toBe(page.button('Clean 26 lines…'))
    expect(page.writes()).toEqual([])
    await act(() => page.button('Clean 26 lines…')!.click())
    await act(() => page.button('Cancel')!.click())
    expect(page.writes()).toEqual([])
  })

  it('cleans once confirmed', async () => {
    const page = await show({ total: 38, cleaned: 12 })
    await page.settle(() => page.button('Clean 26 lines…') !== null)
    await act(() => page.button('Clean 26 lines…')!.click())
    await act(() => page.button('Clean 26 lines')!.click())
    await page.settle(() => page.writes().length === 1)
    expect(page.writes()[0]).toMatchObject({
      path: '/api/characters/keeper/cleaned-lines/clean',
      method: 'POST',
    })
  })

  it('shows the progress with Stop while cleaning, and Stop asks the studio to stop', async () => {
    const job: Job = { kind: 'clean', total: 26, done: 12, failed: [], status: 'running' }
    const page = await show({ total: 38, cleaned: 12, job })
    await page.settle(() => page.text().includes('Cleaning lines in the game… 12 of 26'))
    expect(page.container.querySelector('.progress')).not.toBeNull()
    expect(page.text()).not.toContain('aren’t cleaned yet')
    await act(() => page.button('Stop')!.click())
    await page.settle(() => page.writes().length === 1)
    expect(page.writes()[0]!.path).toBe('/api/characters/keeper/cleaned-lines/stop')
  })

  it('offers the lines that could not be cleaned again, with the reason as given', async () => {
    const job: Job = {
      kind: 'clean',
      total: 3,
      done: 3,
      failed: [{ part: 'act1', key: 'a', message: 'ffmpeg could not clean the voice' }],
      status: 'done',
    }
    const page = await show({ total: 38, cleaned: 35, job })
    await page.settle(() => page.button('Clean 3 lines…') !== null)
    expect(page.text()).toContain('3 of 38 lines in the game aren’t cleaned yet.')
    expect(page.text()).toContain('1 line couldn’t be cleaned: ffmpeg could not clean the voice')
  })

  it('asks before switching off when lines in the game are cleaned, and saves nothing until answered', async () => {
    const page = await show({ total: 38, cleaned: 38 })
    await page.settle(() => page.text().includes('All 38 lines'))
    await act(() => page.flip().click())
    expect(page.flip().checked).toBe(false)
    expect(page.text()).toContain('Put back 38 lines as recorded?')
    expect(page.text()).toContain(
      'Every line of this voice in the game goes back to how it was recorded.',
    )
    expect(page.text()).toContain('New lines are recorded without the clean-up.')
    expect(document.activeElement).toBe(page.button('Switch off and put back'))
    expect(page.writes()).toEqual([])
    // Keep it on: the switch is back on, focus on it, nothing written.
    await act(() => page.button('Keep it on')!.click())
    expect(page.flip().checked).toBe(true)
    expect(document.activeElement).toBe(page.flip())
    expect(page.writes()).toEqual([])
  })

  it('tells the panel while the switch-off question is open, so the Cleaned tag can follow', async () => {
    const page = await show({ total: 38, cleaned: 38 })
    await page.settle(() => page.text().includes('All 38 lines'))
    expect(page.asking.at(-1)).toBe(false)
    await act(() => page.flip().click())
    expect(page.asking.at(-1)).toBe(true)
    await act(() => page.button('Keep it on')!.click())
    expect(page.asking.at(-1)).toBe(false)
    // Escape brings it back too.
    await act(() => page.flip().click())
    expect(page.asking.at(-1)).toBe(true)
    await act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(page.asking.at(-1)).toBe(false)
    // Confirming closes the question as well.
    await act(() => page.flip().click())
    await act(() => page.button('Switch off and put back')!.click())
    expect(page.asking.at(-1)).toBe(false)
  })

  it('switches off and puts back when confirmed: the switch is saved, then the lines put back', async () => {
    const page = await show({ total: 38, cleaned: 38 })
    await page.settle(() => page.text().includes('All 38 lines'))
    await act(() => page.flip().click())
    await act(() => page.button('Switch off and put back')!.click())
    await page.settle(() => page.writes().length === 2)
    expect(page.writes().map((c) => [c.method, c.path, c.body])).toEqual([
      ['PATCH', '/api/characters/keeper', { clean: false }],
      ['POST', '/api/characters/keeper/cleaned-lines/put-back', undefined],
    ])
  })

  it('switches off at once when nothing in the game is cleaned', async () => {
    const page = await show({ total: 38, cleaned: 0 })
    await page.settle(() => page.button('Clean 38 lines…') !== null)
    await act(() => page.flip().click())
    await page.settle(() => page.writes().length === 1)
    expect(page.writes()[0]).toMatchObject({ method: 'PATCH', body: { clean: false } })
    expect(page.text()).not.toContain('Put back')
  })

  it('shows putting back without a Stop button', async () => {
    const job: Job = { kind: 'putback', total: 38, done: 20, failed: [], status: 'running' }
    const page = await show({ total: 38, cleaned: 18, job }, { clean: false })
    await page.settle(() => page.text().includes('Putting back lines as recorded… 20 of 38'))
    expect(page.button('Stop')).toBeNull()
  })

  it('offers the lines still cleaned after a put back that failed, with the reason', async () => {
    const job: Job = {
      kind: 'putback',
      total: 38,
      done: 38,
      failed: [{ part: 'act1', key: 'a', message: 'The original of this line is missing.' }],
      status: 'done',
    }
    const page = await show({ total: 38, cleaned: 3, job }, { clean: false })
    await page.settle(() => page.button('Put them back') !== null)
    expect(page.text()).toContain('3 lines in the game are still cleaned.')
    expect(page.text()).toContain(
      '1 line couldn’t be put back: The original of this line is missing.',
    )
    expect(page.flip().checked).toBe(false)
    await act(() => page.button('Put them back')!.click())
    await page.settle(() => page.writes().length === 1)
    expect(page.writes()[0]!.path).toBe('/api/characters/keeper/cleaned-lines/put-back')
  })

  it('plays the kept original as recorded and the game’s clip as cleaned for a line cleaned in the game', async () => {
    const page = await show({
      total: 1,
      cleaned: 1,
      cleanedFiles: [{ part: 'act1', file: 'a.mp3' }],
    })
    await page.settle(() => page.text().includes('The 1 line in the game is cleaned.'))
    await page.settle(() => page.container.querySelector('select')!.options.length === 2)
    await act(
      () =>
        page.button('Play')?.click() ??
        page.container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click(),
    )
    const sources = FakeAudio.made.map((a) => a.src).sort()
    expect(sources).toEqual(['/api/parts/act1/clips/a.mp3', '/api/parts/act1/originals/a.mp3'])
    expect(page.calls.some((c) => c.path.startsWith('/api/cleaned'))).toBe(false)
  })
})
