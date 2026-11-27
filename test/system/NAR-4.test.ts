// NAR-4: the person can hear a character's recorded lines as the game plays them, one by one or all
// in turn.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fish } from '../../src/server/test-support'
import { unregisterDom } from '../dom'
import { projectJson } from '../helpers'
import { jobEnded, startStudio, wavOf } from './studio'

/** A script of `[key, speaker, text]` rows, as the game writes it. */
const script = (...rows: [string, string, string][]) =>
  rows.map(([id, speaker, text]) => ({ id, speaker, text }))

// The keys do not sort as the dialog runs, and the narrator has more lines than the page first
// shows.
const ACTS = {
  act1: script(
    ['n4', 'narrator', 'The door opened.'],
    ['g1', 'guide', 'Follow me.'],
    ['n2', 'narrator', 'Night fell.'],
    ['n3', 'narrator', 'An owl called.'],
    ['n1', 'narrator', 'The fire died.'],
  ),
  act2: script(['n6', 'narrator', 'Morning came.'], ['n5', 'narrator', 'The road was empty.']),
}

/** The narrator's lines in the order the game says them. */
const SAID = [
  ['act1', 'n4', 'The door opened.'],
  ['act1', 'n2', 'Night fell.'],
  ['act1', 'n3', 'An owl called.'],
  ['act1', 'n1', 'The fire died.'],
  ['act2', 'n6', 'Morning came.'],
  ['act2', 'n5', 'The road was empty.'],
] as const

let takes = 0
const { root, url, page } = startStudio(
  {
    'content-studio.json': projectJson({
      parts: [
        { id: 'act1', title: 'Act I' },
        { id: 'act2', title: 'Act II' },
      ],
    }),
    'content-studio/narration/cast.json': {
      speakers: { narrator: { voice: 'v1' }, guide: { voice: 'v2' } },
    },
    'tts/act1/script.json': ACTS.act1,
    'tts/act2/script.json': ACTS.act2,
  },
  {
    // Each take is a second longer than the one before, so no two clips are alike.
    fish: { ...fish, tts: async () => wavOf(++takes) },
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

/** One sound the page started: what it asked to play, and how. */
interface Sound {
  player: Speaker
  src: string
  loop: boolean
  volume: number
}

/** Every sound the page started, in the order it started them. */
const started: Sound[] = []

/** The browser's audio element, which the test DOM cannot sound: it keeps what it is told. */
class Speaker {
  src = ''
  loop = false
  currentTime = 0
  duration = 1
  volume = 1
  paused = true
  private heard = new Map<string, Set<() => void>>()
  play() {
    this.paused = false
    started.push({ player: this, src: this.src, loop: this.loop, volume: this.volume })
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  addEventListener(type: string, listener: () => void) {
    this.heard.set(type, (this.heard.get(type) ?? new Set()).add(listener))
  }
  removeEventListener(type: string, listener: () => void) {
    this.heard.get(type)?.delete(listener)
  }
  /** The sound plays to its end. */
  end() {
    this.paused = true
    for (const listener of this.heard.get('ended') ?? []) listener()
  }
}
const realAudio = globalThis.Audio
globalThis.Audio = Speaker as unknown as typeof Audio

// React reads `window` when react-dom loads, so it is imported after.
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { App } = await import('../../src/ui/App')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const client = new QueryClient()
const container = document.createElement('div')
document.body.append(container)
const app = createRoot(container)

afterAll(async () => {
  act(() => app.unmount())
  client.clear()
  globalThis.fetch = native.fetch
  globalThis.Audio = realAudio
  await unregisterDom()
})

/** The panel of the character's page that plays the recorded lines. */
const panel = () => document.querySelector('[aria-label="Hear it in the game"]')

/** The panel's button that a person reads as `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...(panel()?.querySelectorAll('button') ?? [])].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
  )
  if (!found) throw new Error(`no "${name}" button in: ${panel()?.textContent}`)
  return found
}

/** Does `what` to the page and lets it draw what follows. */
const does = (what: () => unknown) =>
  act(async () => {
    await what()
  })
const press = (name: string) => does(() => button(name).click())

/** The sounds started since the last look. */
const sounds = () => started.splice(0)

/** The game's clip of a line, as its manifest names it. */
function gameClip(act: string, key: string): string {
  const folder = join(root, 'audio', act)
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as Record<
    string,
    { file: string }
  >
  return readFileSync(join(folder, manifest[key]!.file)).toString('base64')
}

/** Everything the game has of the narration, by path. */
const game = () =>
  Object.fromEntries(
    Object.keys(ACTS).flatMap((act) =>
      readdirSync(join(root, 'audio', act)).map((name) => [
        `${act}/${name}`,
        readFileSync(join(root, 'audio', act, name)).toString('base64'),
      ]),
    ),
  )

/** What the studio serves for a sound, against the game's clip of the line it should be. */
async function isTheGames(sound: Sound, act: string, key: string) {
  expect({ loop: sound.loop, volume: sound.volume }).toEqual({ loop: false, volume: 1 })
  // Inside `act`: what the page reads meanwhile, it draws here.
  await does(async () => {
    const served = await native.fetch(new URL(sound.src, url))
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer()).toString('base64')).toBe(gameClip(act, key))
  })
}

/** The game's narration before anything is heard. */
let recorded: Record<string, string>

beforeAll(async () => {
  // Each act is recorded as the page does it: the plan it shows is what it starts.
  for (const part of Object.keys(ACTS)) {
    const planned = await page.get(`/api/parts/${part}/plan`)
    const { plan } = (await planned.json()) as { plan: { keys: string[] } }
    const job = await page.send('POST', `/api/parts/${part}/jobs`, {
      speaker: null,
      keys: plan.keys,
      orphans: [],
    })
    expect(job.status).toBe(200)
    const { id } = (await job.json()) as { id: string }
    expect(await jobEnded(page, id)).toMatchObject({ status: 'done', failed: [] })
  }
  // A line the game has added since, with no clip yet.
  writeFileSync(
    join(root, 'tts/act2/script.json'),
    JSON.stringify([...ACTS.act2, ...script(['n7', 'narrator', 'A bell rang.'])]),
  )
  recorded = game()

  await act(async () => {
    window.location.hash = '#/characters/narrator'
    app.render(createElement(QueryClientProvider, { client }, createElement(App)))
  })
  const read = () =>
    client.isFetching() + client.isMutating() === 0 &&
    panel()?.textContent?.includes(`${SAID.length} recorded lines`)
  for (const giveUp = Date.now() + 10_000; !read();) {
    if (Date.now() > giveUp) throw new Error(`the page shows: ${document.body.textContent}`)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)))
  }
}, 30_000)

describe('NAR-4: a character’s recorded lines are heard as the game plays them', () => {
  it('plays each line by itself, from the game’s own clip', async () => {
    await press(`All ${SAID.length} lines`)
    for (const [act, key, text] of SAID) {
      await press(`Play “${text}”`)
      const [sound, ...more] = sounds()
      expect(more).toEqual([])
      await isTheGames(sound!, act, key)

      // The same button stops it.
      await press('Stop')
      expect(sound!.player.paused).toBe(true)
    }
    expect(sounds()).toEqual([])
    await press('Show fewer')
  })

  it('plays all of them in turn, each when the one before it has ended', async () => {
    await press('Play all in turn')
    for (const [act, key] of SAID) {
      const [sound, ...more] = sounds()
      expect(more).toEqual([])
      await isTheGames(sound!, act, key)
      await does(() => sound!.player.end())
    }
    // After the last one it is over.
    expect(sounds()).toEqual([])
    button('Play all in turn')
  })

  it('leaves the game’s files as they were', () => {
    expect(game()).toEqual(recorded)
  })
})
