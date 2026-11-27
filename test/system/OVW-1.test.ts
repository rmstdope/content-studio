// OVW-1: a part's overview shows what is missing or out of date for that part, so the person knows
// what is left to do.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fish } from '../../src/server/test-support'
import { unregisterDom } from '../dom'
import { projectJson } from '../helpers'
import { jobEnded, startStudio, wavOf } from './studio'

/** A script of `[key, speaker, text]` rows, as the game writes it. */
const script = (...rows: [string, string, string][]) =>
  rows.map(([id, speaker, text]) => ({ id, speaker, text }))

const ACT1 = script(['a1', 'narrator', 'The door opened.'], ['a2', 'guide', 'Follow me.'])
const ACT2 = script(['b1', 'narrator', 'Morning came.'])

let takes = 0
const { root, url, page } = startStudio(
  {
    'content-studio.json': projectJson(),
    'content-studio/narration/cast.json': {
      speakers: { narrator: { voice: 'v1' }, guide: { voice: 'v2' } },
    },
    'tts/act1/script.json': ACT1,
    'tts/act2/script.json': ACT2,
  },
  // Each take is a second longer than the one before, so no two clips are alike.
  { fish: { ...fish, tts: async () => wavOf(++takes) } },
)

// The DOM is the studio's page: it comes after the server is up, and Bun's own requests and
// answers are put back, which the server in this process is built on.
const native = { fetch, Request, Response, Headers, AbortController, AbortSignal }
GlobalRegistrator.register({ url: url.href })
Object.assign(globalThis, native)
// The page asks for the studio's paths, as a page the studio served does.
globalThis.fetch = ((path: string, init?: RequestInit) =>
  native.fetch(new URL(path, url), init)) as typeof fetch

// React reads `window` when react-dom loads, so it is imported after.
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('../../src/ui/App')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Takes down the page that is open, if one is. */
let close = () => {}

afterAll(async () => {
  close()
  globalThis.fetch = native.fetch
  await unregisterDom()
})

/**
 * Opens a part's overview afresh, as a person loading it does, and answers what it says there is
 * to do: the lines up to date, the count of each other status, why lines are stale, the button
 * to generate what is left, and how each character's lines stand.
 */
async function overview(part: string) {
  close()
  const container = document.createElement('div')
  document.body.append(container)
  const view = createRoot(container)
  const client = new QueryClient()
  close = () => {
    act(() => view.unmount())
    client.clear()
    container.remove()
    close = () => {}
  }
  window.location.hash = `#/parts/${part}`
  await act(async () => {
    view.render(createElement(QueryClientProvider, { client }, createElement(App)))
  })
  const find = (selector: string) => [...container.querySelectorAll(selector)]
  const text = (selector: string) => find(selector).map((e) => e.textContent!)
  for (const giveUp = Date.now() + 10_000; ;) {
    if (find('[aria-label="Clip status"]').length && client.isFetching() === 0) break
    if (Date.now() > giveUp) throw new Error(`${part} never showed: ${container.textContent}`)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
  }
  return {
    upToDate: text('[aria-label="Clip status"] .stat-lead strong').join(),
    left: text('[aria-label="Clip status"] .status-chip'),
    why: text('[aria-label="Clip status"] .status-note'),
    generate: text('a.btn-primary'),
    cast: Object.fromEntries(
      find('[aria-label="Cast"] article').map((card) => [
        card.getAttribute('aria-label'),
        card.querySelector('.card-status-text span:last-child')?.textContent,
      ]),
    ),
  }
}

/** Records what the part's plan offers, as the person does from the part's lines page. */
async function record(part: string) {
  const planned = await page.get(`/api/parts/${part}/plan`)
  const { plan } = (await planned.json()) as { plan: { keys: string[] } }
  const started = await page.send('POST', `/api/parts/${part}/jobs`, {
    speaker: null,
    keys: plan.keys,
    orphans: [],
    retakeWeak: false,
  })
  expect(started.status).toBe(200)
  const { id } = (await started.json()) as { id: string }
  expect(await jobEnded(page, id)).toMatchObject({ status: 'done', failed: [] })
}

/** The clips of a part as the game has them: each line of its manifest, with its audio. */
function game(part: string): Record<string, string> {
  const folder = join(root, 'audio', part)
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as Record<
    string,
    { file: string }
  >
  return Object.fromEntries(
    Object.entries(manifest).map(([key, { file }]) => [
      key,
      readFileSync(join(folder, file)).toString('base64'),
    ]),
  )
}

// One walk over one studio: each test goes on from what the ones before it made.
describe('OVW-1: a part’s overview shows what is missing or out of date, and so what is left', () => {
  const done = (lines: number) => ({
    upToDate: `${lines} / ${lines}`,
    left: [],
    why: [],
    generate: [],
  })

  it('shows a part nothing is recorded for as missing every line', async () => {
    expect(await overview('act1')).toEqual({
      upToDate: '0 / 2',
      left: ['Missing 2'],
      why: [],
      generate: ['Generate 2 lines'],
      cast: { Narrator: '1 missing', Guide: '1 missing' },
    })
  })

  it('shows what the game has since added or changed in that part, and in no other', async () => {
    await record('act1')
    await record('act2')
    // The game rewrites the first act: one line is reworded and one is new.
    writeFileSync(
      join(root, 'tts/act1/script.json'),
      JSON.stringify([
        ACT1[0],
        { ...ACT1[1], text: 'Come with me.' },
        ...script(['a3', 'guide', 'Mind the step.']),
      ]),
    )

    expect(await overview('act1')).toEqual({
      upToDate: '1 / 3',
      left: ['Stale 1', 'Missing 1'],
      why: ['Stale because: wording changed (1)'],
      generate: ['Generate 2 lines'],
      cast: { Narrator: 'all up to date', Guide: '1 missing · 1 stale' },
    })
    expect(await overview('act2')).toEqual({ ...done(1), cast: { Narrator: 'all up to date' } })
  })

  it('shows nothing left once the game has those lines’ clips', async () => {
    const before = game('act1')
    await record('act1')

    const after = game('act1')
    expect(Object.keys(after).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(after.a1).toBe(before.a1!)
    expect(after.a2).not.toBe(before.a2!)
    expect(await overview('act1')).toEqual({
      ...done(3),
      cast: { Narrator: 'all up to date', Guide: 'all up to date' },
    })
  })
})
