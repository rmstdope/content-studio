// IMG-3: fine-tune: the person makes variations of a picture, compares them and chooses or drops
// each, and a choice can be undone. That Choose and Drop stay off for a second on a card that has
// just turned ready is the page's alone, and is proven where the page is
// (FineTunePanel.test.tsx).
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fineTuneHistory, type FineTunesView } from '../../src/core/imageFineTunes'
import type { ImageTakesView } from '../../src/core/imageTakes'
import type { ImageRequest } from '../../src/services/images'
import { createFakeImages } from '../../src/services/imagesFake'
import { decodePng, encodePng } from '../../src/services/png'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** What the fake model paints, one flat colour per picture asked for, which tells them apart. */
const PAINTS = ['#808080', '#c02020', '#20c020', '#2020c0']

/** The one colour of a PNG, as `#rrggbb`, and its size. */
function lookOf(png: Uint8Array) {
  const { width, height, data } = decodePng(png)
  const colours = new Set<string>()
  for (let i = 0; i < data.length; i += 4) {
    colours.add(`#${Buffer.from(data.subarray(i, i + 3)).toString('hex')}`)
  }
  return { width, height, colours: [...colours] }
}

/** A picture of one colour, as the model gives it. */
function painting(width: number, height: number, colour: string) {
  const pixel = [...Buffer.from(colour.slice(1), 'hex'), 255]
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(pixel, i)
  return encodePng({ width, height, data })
}

describe('IMG-3: variations of a picture are compared, chosen or dropped, and undone', () => {
  setDefaultTimeout(30_000)

  /** What the local models were asked for, in turn. */
  const asked: ImageRequest[] = []
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson({
        images: {
          from: { part: 'tts/{part}/images.json' },
          clips: 'web/images',
          manifest: 'web/images/manifest.json',
        },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/act1/images.json': [
        { id: 'inn', title: 'Inn', text: 'A low inn', width: 90, height: 60 },
      ],
    },
    {
      images: {
        ...createFakeImages(0),
        generate: async (request) => {
          const colour = PAINTS[asked.push(request) - 1]!
          return { png: painting(request.width, request.height, colour), seed: request.seed }
        },
      },
    },
  )

  /** Every file of the game with its content, but for the studio's cache. */
  function game(): Record<string, string> {
    const paths = (readdirSync(root, { recursive: true }) as string[]).sort()
    return Object.fromEntries(
      paths
        .filter((path) => !path.startsWith('content-studio/cache/'))
        .filter((path) => statSync(join(root, path)).isFile())
        .map((path) => [path, readFileSync(join(root, path)).toString('base64')]),
    )
  }
  const before = game()

  /** The picture the game has now. */
  const inGame = () => new Uint8Array(readFileSync(join(root, 'web/images/inn.png')))

  const takesOf = async () =>
    (await (await page.get('/api/images/inn/takes')).json()) as ImageTakesView
  const tunesOf = async () =>
    (await (await page.get('/api/images/inn/fine-tunes')).json()) as FineTunesView

  /** A picture the page shows, which must be there. */
  async function shown(path: string) {
    const answer = await page.get(path)
    expect(answer.status).toBe(200)
    return lookOf(new Uint8Array(await answer.arrayBuffer())).colours
  }

  /** A change the page asks for, which must be taken. */
  async function send<T>(method: string, path: string, body?: unknown) {
    const answer = await page.send(method, path, body)
    expect(answer.status).toBe(200)
    return (await answer.json()) as T
  }

  /** Asks as the page does until `ready` holds. */
  async function until(what: string, ready: () => Promise<boolean>) {
    for (const giveUp = Date.now() + 20_000; !(await ready());) {
      if (Date.now() > giveUp) throw new Error(`${what} never came`)
      await Bun.sleep(10)
    }
  }

  /** The picture the game had before any variation, and its manifest. */
  let first: { picture: ReturnType<typeof inGame>; manifest: string }
  const manifest = () => readFileSync(join(root, 'web/images/manifest.json'), 'utf8')

  it('makes variations of the picture in the game, as many as asked, changing nothing there', async () => {
    await send('POST', '/api/images/inn/takes', { count: 1 })
    await until('the take', async () => (await takesOf()).takes[0]?.look === 'ready')
    await send('POST', '/api/images/inn/choose', { n: 1 })
    first = { picture: inGame(), manifest: manifest() }
    expect(lookOf(first.picture)).toEqual({ width: 90, height: 60, colours: [PAINTS[0]!] })

    await send('POST', '/api/images/inn/fine-tunes', {
      count: 3,
      words: 'Paint the door',
      area: null,
    })
    await until('the variations', async () => {
      const view = await tunesOf()
      expect(view.failed).toEqual([])
      return view.tunes.length === 3
    })

    const view = await tunesOf()
    expect(view.picture).toMatchObject({ kind: 'take', n: 1 })
    expect(view.tunes.map((tune) => [tune.words, tune.isNew])).toEqual(
      Array(3).fill(['Paint the door', true]),
    )
    // Each was made by editing a picture, from the person's words.
    expect(asked.slice(1).map((r) => [r.prompt, r.editing !== undefined])).toEqual(
      Array(3).fill(['Paint the door', true]),
    )
    expect(inGame()).toEqual(first.picture)
    expect(manifest()).toBe(first.manifest)
  })

  it('shows the picture they were made from and each variation, to compare', async () => {
    expect(await shown('/api/images/inn/fine-tunes/base')).toEqual([PAINTS[0]!])
    const seen: string[] = []
    for (const { n } of (await tunesOf()).tunes) {
      seen.push(...(await shown(`/api/images/inn/fine-tunes/${n}`)))
      await send('POST', `/api/images/inn/fine-tunes/${n}/seen`)
    }
    expect(seen.sort()).toEqual(PAINTS.slice(1).sort())
    expect((await tunesOf()).tunes.map((tune) => tune.isNew)).toEqual([false, false, false])
  })

  it('drops the variation the person drops and no other, leaving the game as it was', async () => {
    const [dropped, ...kept] = (await tunesOf()).tunes
    await send('DELETE', `/api/images/inn/fine-tunes/${dropped!.n}`)

    expect((await tunesOf()).tunes.map((tune) => tune.n)).toEqual(kept.map((tune) => tune.n))
    expect((await page.get(`/api/images/inn/fine-tunes/${dropped!.n}`)).status).toBe(404)
    expect(inGame()).toEqual(first.picture)
    expect(manifest()).toBe(first.manifest)
  })

  it('gives the game the variation the person chooses, as the picture’s next take', async () => {
    const chosen = (await tunesOf()).tunes.at(-1)!
    const [colour] = await shown(`/api/images/inn/fine-tunes/${chosen.n}`)

    const answer = await send<{ take: number }>('POST', '/api/images/inn/fine-tunes/use', {
      n: chosen.n,
    })

    expect(lookOf(inGame())).toEqual({ width: 90, height: 60, colours: [colour!] })
    // The manifest names the file and its size, which a variation keeps.
    expect(manifest()).toBe(first.manifest)
    const takes = await takesOf()
    expect(takes.chosen).toEqual({ known: true, take: answer.take })
    expect(takes.takes.find((take) => take.n === answer.take)?.fineTunedFrom).toEqual({
      take: 1,
      words: 'Paint the door',
    })
  })

  it('undoes the choice, giving the game the picture it had, and keeps the undone take', async () => {
    const takes = await takesOf()
    const chosen = takes.chosen.known ? takes.chosen.take : null
    // Undo chooses the step before the one in the game, as the page works it out.
    const { undoTo } = fineTuneHistory(takes.takes, chosen)
    expect(undoTo).toBe(1)

    await send('POST', '/api/images/inn/choose', { n: undoTo })

    expect(inGame()).toEqual(first.picture)
    expect(manifest()).toBe(first.manifest)
    const after = await takesOf()
    expect(after.chosen).toEqual({ known: true, take: 1 })
    expect(after.takes.map((take) => take.n).sort((a, b) => a - b)).toEqual([1, chosen!])
  })

  it('changes only the images’ picture and manifest and the studio’s own files', () => {
    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()

    expect(changed).toEqual([
      'content-studio/images/lock.json',
      'web/images/inn.png',
      'web/images/manifest.json',
    ])
  })
})
