// MUS-3: Make all makes takes for every track of an act that has none, and can be stopped.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MusicMakingSummary, MusicTakesView } from '../../src/core/musicTake'
import { createFakeMusic } from '../../src/services/musicFake'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

describe('MUS-3: Make all makes an act’s missing takes, and can be stopped', () => {
  setDefaultTimeout(30_000)

  const track = (id: string) => ({ id, title: id, text: `Music of the ${id}`, seconds: 5 })
  /** What the local model was asked to make, by the track's brief, in turn. */
  const asked: string[] = []
  /** How many more takes the model finishes; any after them ends only when it is stopped. */
  let finishes = Infinity
  /** The takes the model was told to give up. */
  const givenUp: string[] = []
  const model = createFakeMusic(0)
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson({
        music: {
          from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
          clips: 'audio/music',
          manifest: 'audio/music/manifest.json',
        },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/act1/music.json': [track('hall'), track('mill'), track('well')],
      'tts/act2/music.json': [track('ford'), track('barn')],
      'tts/stingers.json': [track('victory')],
    },
    {
      music: {
        ...model,
        generate: async (request, signal) => {
          asked.push(request.brief)
          if (finishes-- <= 0) {
            await new Promise<never>((_, reject) => {
              const giveUp = () => {
                givenUp.push(request.brief)
                reject(new Error('stopped'))
              }
              // The stop may come before the model is called.
              if (signal!.aborted) giveUp()
              else signal!.addEventListener('abort', giveUp)
            })
          }
          return model.generate(request)
        },
      },
    },
  )

  const read = async <T>(path: string) => (await (await page.get(path)).json()) as T
  const takesOf = (id: string) => read<MusicTakesView>(`/api/music/tracks/${id}/takes`)
  const making = () => read<Record<string, MusicMakingSummary>>('/api/music/making')
  /** How many takes each track has. */
  const counts = async () =>
    Object.fromEntries(
      await Promise.all(
        ['hall', 'mill', 'well', 'ford', 'barn', 'victory'].map(async (id) => [
          id,
          (await takesOf(id)).takes.length,
        ]),
      ),
    ) as Record<string, number>
  /** The game's music: each file of its clips folder with its content. */
  const game = () =>
    Object.fromEntries(
      readdirSync(join(root, 'audio/music'))
        .sort()
        .map((name) => [name, readFileSync(join(root, 'audio/music', name), 'base64')]),
    )

  /** A change the page asks for, which must be taken. */
  async function send<T>(path: string, body?: unknown) {
    const response = await page.send('POST', path, body)
    expect(response.status).toBe(200)
    return (await response.json()) as T
  }

  /** Asks as the page does until `ready` holds. */
  async function until(what: string, ready: () => boolean | Promise<boolean>) {
    for (const giveUp = Date.now() + 20_000; !(await ready());) {
      if (Date.now() > giveUp) throw new Error(`${what} never came`)
      await Bun.sleep(10)
    }
  }

  /** Waits until the track has `count` takes and none is being made. */
  async function made(id: string, count: number) {
    await until(`the takes of ${id}`, async () => {
      const view = await takesOf(id)
      expect(view.failed).toEqual([])
      return view.making.length === 0 && view.takes.length === count
    })
  }

  // The cases follow on from one another: the second starts from the takes the first made.
  it('makes takes for every track of the act that has none, and for no other', async () => {
    // One track of the act has a take the person chose.
    await send('/api/music/tracks/hall/takes', { count: 1 })
    await made('hall', 1)
    await send('/api/music/tracks/hall/choose', { file: (await takesOf('hall')).takes[0]!.file })
    const chosen = game()
    expect(Object.keys(chosen)).toEqual(['hall.mp3', 'manifest.json'])
    asked.length = 0

    expect(await send('/api/music/lists/act1/make-all')).toEqual({ ok: true, tracks: 2, takes: 8 })
    await made('mill', 4)
    await made('well', 4)

    expect(asked).toEqual([
      ...Array(4).fill('Music of the mill'),
      ...Array(4).fill('Music of the well'),
    ])
    expect(await counts()).toEqual({ hall: 1, mill: 4, well: 4, ford: 0, barn: 0, victory: 0 })
    // The takes wait for the person to choose: the game has only what was chosen.
    expect(game()).toEqual(chosen)
  })

  it('stops, keeping the takes made and leaving the rest unmade', async () => {
    const before = game()
    asked.length = 0
    finishes = 1
    await send('/api/music/lists/act2/make-all')
    await until('ford’s second take', async () => {
      return asked.length === 2 && (await making()).ford?.takes === 3
    })

    expect(await send('/api/music/lists/act2/stop')).toEqual({
      ok: true,
      stopped: 7,
      byTrack: { ford: 3, barn: 4 },
    })

    expect(await read('/api/music/lists/act2/batch')).toMatchObject({ running: false })
    expect((await making()).ford?.takes ?? 0).toBe(0)
    expect((await making()).barn?.takes ?? 0).toBe(0)

    // Takes are made one at a time, in turn: once a later one is made, none is left before it.
    finishes = Infinity
    await send('/api/music/tracks/hall/takes', { count: 1 })
    await made('hall', 2)
    await made('ford', 1)

    // The take being made was given up, as was any the model had begun while the stop went
    // through the act; the model was asked for no other.
    const begun = asked.slice(1, -1)
    expect(begun[0]).toBe('Music of the ford')
    expect(givenUp).toEqual(begun)
    expect(asked.at(-1)).toBe('Music of the hall')
    expect(await counts()).toEqual({ hall: 2, mill: 4, well: 4, ford: 1, barn: 0, victory: 0 })
    expect(game()).toEqual(before)
  })
})
