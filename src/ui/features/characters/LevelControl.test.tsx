import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { LevelControl } = await import('./LevelControl')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  await GlobalRegistrator.unregister()
})

type Data = NonNullable<Parameters<typeof LevelControl>[0]['data']>
const data = (over: Partial<Data> = {}): Data => ({
  total: 38,
  cleaned: 0,
  cleanedFiles: [],
  problem: null,
  job: null,
  levels: [],
  levelJob: null,
  ...over,
})

describe('LevelControl', () => {
  const realFetch = globalThis.fetch
  const roots: { unmount: () => void }[] = []
  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()))
    globalThis.fetch = realFetch
    document.body.innerHTML = ''
  })

  async function show(
    props: { saved?: number; data?: Data; cleaning?: boolean; answer?: () => Response } = {},
  ) {
    const calls: { path: string; method: string; body: unknown }[] = []
    globalThis.fetch = (async (path: string, init?: RequestInit) => {
      calls.push({
        path,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (path.includes('/level')) return props.answer?.() ?? Response.json({ ok: true, job: null })
      return Response.json({})
    }) as unknown as typeof fetch
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const seen: (number | null)[] = []
    function Page() {
      const [trial, setTrial] = useState<number | null>(null)
      seen.push(trial)
      return createElement(LevelControl, {
        characterId: 'keeper',
        language: 'sv',
        saved: props.saved ?? 100,
        data: props.data ?? data(),
        trial,
        onTrial: setTrial,
        cleaning: props.cleaning ?? false,
      })
    }
    await act(() =>
      root.render(createElement(QueryClientProvider, { client }, createElement(Page))),
    )
    const text = () => container.textContent ?? ''
    const slider = () => container.querySelector<HTMLInputElement>('input[type="range"]')!
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === name)
    /** Moves the slider the way a person does: the value changes, then the event. */
    const move = async (value: number) => {
      const input = slider()
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, String(value))
      await act(() => {
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const settle = async (ready: () => boolean) => {
      for (let i = 0; i < 100 && !ready(); i++) {
        await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
      }
      expect(ready()).toBe(true)
    }
    return { container, calls, text, slider, button, move, settle, seen }
  }

  it('is a slider from 10% to 200% in steps of 5, with its scale and hint, and nothing else at the saved level', async () => {
    const page = await show()
    expect(page.slider().min).toBe('10')
    expect(page.slider().max).toBe('200')
    expect(page.slider().step).toBe('5')
    expect(page.slider().value).toBe('100')
    expect(page.text()).toContain('Level')
    for (const mark of ['10%', '100%', '200%']) expect(page.text()).toContain(mark)
    expect(page.container.querySelector('strong.level-pct')?.textContent).toBe('100%')
    expect(page.text()).toContain(
      'How loud this voice plays next to the others. 100% is the loudness every line is levelled to.',
    )
    expect(page.text()).not.toContain('Not set yet')
    expect(page.text()).not.toContain('Above 100%')
  })

  it('tries first: moving it says it is not set, saves nothing, and Undo takes that away', async () => {
    const page = await show()
    await page.move(60)
    expect(page.container.querySelector('strong.level-pct')?.textContent).toBe('60%')
    expect(page.text()).toContain('Not set yet — this voice plays at 100%.')
    expect(page.button('Set 60%…')).toBeDefined()
    expect(page.calls).toEqual([])
    await act(() => page.button('Undo')!.click())
    expect(page.text()).not.toContain('Not set yet')
    expect(page.slider().value).toBe('100')
    // Moving it back to the saved level does the same.
    await page.move(60)
    await page.move(100)
    expect(page.text()).not.toContain('Not set yet')
  })

  it('notes the softening above 100%, set or not', async () => {
    const page = await show()
    await page.move(120)
    expect(page.text()).toContain(
      'Above 100%, the loudest moments are softened so they don’t crackle.',
    )
    const saved = await show({ saved: 150 })
    expect(saved.text()).toContain('Above 100%, the loudest moments')
  })

  it('asks before rewriting the lines in the game, and Cancel writes nothing', async () => {
    const page = await show()
    await page.move(60)
    await act(() => page.button('Set 60%…')!.click())
    expect(page.text()).toContain('Set this voice to 60%?')
    expect(page.text()).toContain('The 38 lines in the game are rewritten at 60%.')
    expect(page.text()).toContain('New lines are recorded at 60%.')
    expect(page.text()).toContain('Setting it back to 100% puts them back as they are now.')
    expect(document.activeElement?.textContent).toBe('Set 60%')
    await act(() => page.button('Cancel')!.click())
    expect(page.text()).toContain('Not set yet')
    expect(document.activeElement?.textContent).toBe('Set 60%…')
    expect(page.calls).toEqual([])
    // Escape does the same.
    await act(() => page.button('Set 60%…')!.click())
    await act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(page.text()).toContain('Not set yet')
    expect(page.calls).toEqual([])
  })

  it('saves the level for the language shown when the question is confirmed', async () => {
    const page = await show()
    await page.move(60)
    await act(() => page.button('Set 60%…')!.click())
    await act(() => page.button('Set 60%')!.click())
    await page.settle(() => page.calls.length > 0)
    expect(page.calls[0]).toEqual({
      path: '/api/characters/keeper/level?language=sv',
      method: 'POST',
      body: { level: 60 },
    })
    await page.settle(() => !page.text().includes('Not set yet'))
  })

  it('says "line" for one line in the game', async () => {
    const page = await show({ data: data({ total: 1 }) })
    await page.move(60)
    await act(() => page.button('Set 60%…')!.click())
    expect(page.text()).toContain('The 1 line in the game is rewritten at 60%.')
  })

  it('saves at once, with no question, when no line is in the game', async () => {
    const page = await show({ data: data({ total: 0 }) })
    await page.move(60)
    expect(page.button('Set 60%…')).toBeUndefined()
    await act(() => page.button('Set 60%')!.click())
    await page.settle(() => page.calls.length === 1)
    expect(page.text()).not.toContain('Set this voice to')
  })

  it('keeps the line and says why when the level cannot be saved', async () => {
    const page = await show({
      data: data({ total: 0 }),
      answer: () =>
        Response.json(
          { ok: false, problems: [{ file: 'cast.json', path: '', message: 'read-only' }] },
          { status: 409 },
        ),
    })
    await page.move(60)
    await act(() => page.button('Set 60%')!.click())
    await page.settle(() => page.text().includes('Couldn’t save the level: read-only'))
    expect(page.text()).toContain('Not set yet — this voice plays at 100%.')
  })

  it('shows the rewriting with a count and no Stop, and locks the slider', async () => {
    const levelJob = { level: 60, total: 38, done: 12, failed: [], status: 'running' as const }
    const page = await show({ saved: 60, data: data({ levelJob }) })
    expect(page.text()).toContain('Setting lines in the game to 60%… 12 of 38')
    expect(page.button('Stop')).toBeUndefined()
    expect(page.slider().disabled).toBe(true)
  })

  it('offers to set the lines that are still at another level, and says why some could not be set', async () => {
    const levels = [
      { part: 'act1', file: 'a.mp3', level: 100 },
      { part: 'act1', file: 'b.mp3', level: 60 },
      { part: 'act1', file: 'c.mp3', level: 100 },
    ]
    const levelJob = {
      level: 60,
      total: 2,
      done: 2,
      failed: [
        { part: 'act1', key: 'a', message: 'ffmpeg went wrong' },
        { part: 'act1', key: 'c', message: 'ffmpeg went wrong' },
      ],
      status: 'done' as const,
    }
    const page = await show({ saved: 60, data: data({ levels, levelJob }) })
    expect(page.text()).toContain('2 lines in the game are still at 100%.')
    expect(page.text()).toContain('2 lines couldn’t be set to 60%: ffmpeg went wrong')
    await act(() => page.button('Set them to 60%')!.click())
    await page.settle(() => page.calls.length === 1)
    expect(page.calls[0]?.body).toEqual({ level: 60 })
    expect(page.text()).not.toContain('Set this voice to')
  })

  it('cannot set while the lines are being cleaned, and says to wait', async () => {
    const page = await show({ cleaning: true })
    await page.move(60)
    expect(page.button('Set 60%…')!.getAttribute('aria-disabled')).toBe('true')
    expect(page.text()).toContain('Wait for the lines to finish being cleaned.')
    await act(() => page.button('Set 60%…')!.click())
    expect(page.text()).not.toContain('Set this voice to')
  })
})
