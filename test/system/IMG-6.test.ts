// IMG-6: Make all makes takes for every image of an act that has none, and can be stopped.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import type { ImageMakingSummary, ImageTakesView } from '../../src/core/imageTakes'
import type { ImageRequest } from '../../src/services/images'
import { createFakeImages, fakePng } from '../../src/services/imagesFake'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

describe('IMG-6: Make all makes an act’s missing takes, and can be stopped', () => {
  setDefaultTimeout(30_000)

  const image = (id: string) => ({ id, title: id, text: `A ${id}`, width: 96, height: 64 })
  /** What the local model was asked to paint, by the image's words, in turn. */
  const asked: string[] = []
  /** How many more takes the model finishes; any after them ends only when it is stopped. */
  let finishes = Infinity
  /** The takes the model was told to give up. */
  const givenUp: string[] = []
  const words = (request: ImageRequest) => request.prompt.split('\n')[0]!
  const { page } = startStudio(
    {
      'content-studio.json': projectJson({
        images: {
          from: { part: 'tts/{part}/images.json' },
          clips: 'web/images',
          manifest: 'web/images/manifest.json',
        },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/act1/images.json': [image('inn'), image('mill'), image('well')],
      'tts/act2/images.json': [image('ford'), image('barn')],
    },
    {
      images: {
        ...createFakeImages(0),
        generate: async (request, signal) => {
          asked.push(words(request))
          if (finishes-- <= 0) {
            await new Promise<never>((_, reject) =>
              signal!.addEventListener('abort', () => {
                givenUp.push(words(request))
                reject(new Error('stopped'))
              }),
            )
          }
          return {
            png: fakePng(request.width, request.height, request.seed),
            seed: request.seed,
          }
        },
      },
    },
  )

  const read = async <T>(path: string) => (await (await page.get(path)).json()) as T
  const takesOf = (id: string) => read<ImageTakesView>(`/api/images/${id}/takes`)
  const making = () => read<Record<string, ImageMakingSummary>>('/api/images/making')
  /** How many takes each image has. */
  const counts = async () =>
    Object.fromEntries(
      await Promise.all(
        ['inn', 'mill', 'well', 'ford', 'barn'].map(async (id) => [
          id,
          (await takesOf(id)).takes.length,
        ]),
      ),
    ) as Record<string, number>

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

  /** Waits until the image has `count` takes, each ready to be looked at, and none is being made. */
  async function made(id: string, count: number) {
    await until(`the takes of ${id}`, async () => {
      const view = await takesOf(id)
      expect(view.failed).toEqual([])
      return (
        view.making.length === 0 &&
        view.takes.length === count &&
        view.takes.every((take) => take.look === 'ready')
      )
    })
  }

  it('makes takes for every image of the act that has none, and for no other', async () => {
    // One image of the act has a take the person chose.
    await send('/api/images/inn/takes', { count: 1 })
    await made('inn', 1)
    await send('/api/images/inn/choose', { n: 1 })
    asked.length = 0

    expect(await send('/api/image-acts/act1/make-all')).toEqual({
      ok: true,
      images: ['mill', 'well'],
      takes: 8,
    })
    await made('mill', 4)
    await made('well', 4)

    expect(asked).toEqual([...Array(4).fill('A mill'), ...Array(4).fill('A well')])
    expect(await counts()).toEqual({ inn: 1, mill: 4, well: 4, ford: 0, barn: 0 })
  })

  it('stops, keeping the takes made and leaving the rest unmade', async () => {
    asked.length = 0
    finishes = 1
    await send('/api/image-acts/act2/make-all')
    await until('the second take of the press', async () => {
      return asked.length === 2 && (await making()).ford?.takes === 3
    })

    expect(await send('/api/image-acts/act2/stop')).toEqual({ ok: true, stopped: 7 })

    expect(await read('/api/image-acts/act2/batch')).toMatchObject({ running: false })
    expect((await making()).ford?.takes ?? 0).toBe(0)
    expect((await making()).barn?.takes ?? 0).toBe(0)

    // Takes are made one at a time, in turn: once a later one is made, none is left before it.
    finishes = Infinity
    await send('/api/images/inn/takes', { count: 1 })
    await made('inn', 2)
    await made('ford', 1)

    // The take being made was given up, as was any the model had begun while the stop went
    // through the act; the model was asked for no other.
    const begun = asked.slice(1, -1)
    expect(begun[0]).toBe('A ford')
    expect(givenUp).toEqual(begun)
    expect(asked.at(-1)).toBe('A inn')
    expect(await counts()).toEqual({ inn: 2, mill: 4, well: 4, ford: 1, barn: 0 })
  })
})
