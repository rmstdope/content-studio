// IMG-1: each image the game lists can be made as takes with a local model, in the act's style,
// which the person sets. The person chooses a take, and the game gets it at the listed size and in
// the palette.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageTakesView } from '../../src/core/imageTakes'
import type { ProjectSummary } from '../../src/core/summary'
import type { ImageRequest } from '../../src/services/images'
import { createFakeImages } from '../../src/services/imagesFake'
import { decodePng, encodePng } from '../../src/services/png'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** The game's palette. */
const PALETTE = ['#101010', '#e00000', '#0000e0', '#f0f0f0']

/**
 * What the fake model paints, one colour per take: none is in the palette, and each is so near one
 * of its colours that the whole picture becomes that colour, however its shades are made.
 */
const PAINTS = [
  { painted: '#f40c0c', inPalette: '#e00000' },
  { painted: '#0c0cf4', inPalette: '#0000e0' },
]

/** Every colour in a PNG, as `#rrggbb`. */
function coloursOf(png: Uint8Array): string[] {
  const { data } = decodePng(png)
  const colours = new Set<string>()
  for (let i = 0; i < data.length; i += 4) {
    colours.add(`#${Buffer.from(data.subarray(i, i + 3)).toString('hex')}`)
  }
  return [...colours]
}

/** A picture of one colour, as the model gives it. */
function painting(width: number, height: number, colour: string) {
  const pixel = [...Buffer.from(colour.slice(1), 'hex'), 255]
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(pixel, i)
  return encodePng({ width, height, data })
}

describe('IMG-1: an image is made in the act’s style and chosen', () => {
  setDefaultTimeout(30_000)

  /** The game's images, by act: their listed sizes are none the model can make. */
  const listed = {
    act1: { id: 'inn', title: 'Inn', text: 'A low inn', width: 90, height: 60 },
    act2: { id: 'well', title: 'Well', text: 'A stone well', width: 50, height: 70 },
  }
  /** What the local model was asked for, in turn. */
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
      'tts/act1/images.json': [listed.act1],
      'tts/act2/images.json': [listed.act2],
      // The palette and what each act adds are set in the file; the rest on the Style page.
      'content-studio/images/edits.json': {
        style: {
          look: 'plain',
          palette: PALETTE,
          parts: { act1: 'Lantern light', act2: 'A cold dawn' },
        },
        images: {},
      },
    },
    {
      images: {
        ...createFakeImages(0),
        generate: async (request) => {
          asked.push(request)
          const { painted } = PAINTS[(asked.length - 1) % PAINTS.length]!
          return {
            png: painting(request.width, request.height, painted),
            seed: request.seed,
          }
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

  /** The images as the Images pages list them, over all acts. */
  async function rows() {
    const response = await page.get('/api/project')
    const { summary } = (await response.json()) as { summary: ProjectSummary }
    return summary.images!.acts.flatMap((act) => act.rows)
  }

  const takesOf = async (id: string) =>
    (await (await page.get(`/api/images/${id}/takes`)).json()) as ImageTakesView

  /** Asks for `count` takes of an image and waits for them, as its page does. */
  async function make(id: string, count: number) {
    const answer = await page.send('POST', `/api/images/${id}/takes`, { count })
    expect(answer.status).toBe(200)
    for (const giveUp = Date.now() + 20_000; ;) {
      const view = await takesOf(id)
      expect(view.failed).toEqual([])
      if (view.making.length === 0 && view.takes.every((take) => take.look === 'ready')) {
        expect(view.takes).toHaveLength(count)
        return
      }
      if (Date.now() > giveUp) throw new Error(`${id}: the takes never came`)
      await Bun.sleep(10)
    }
  }

  it('makes takes of each listed image with a local model, in the style the person set for its act', async () => {
    expect((await rows()).map((row) => row.id)).toEqual(['inn', 'well'])

    for (const style of [{ look: 'Flat pixel art' }, { keepOut: 'letters' }]) {
      expect((await page.send('PATCH', '/api/image-style', style)).status).toBe(200)
    }
    await make('inn', 2)
    await make('well', 1)

    const inn = 'A low inn\nLantern light\nFlat pixel art\nKept out: letters'
    const well = 'A stone well\nA cold dawn\nFlat pixel art\nKept out: letters'
    expect(asked.map(({ model, prompt }) => [model, prompt])).toEqual([
      ['klein', inn],
      ['klein', inn],
      ['klein', well],
    ])
  })

  it('gives the game the take the person chooses, at the listed size and in the palette', async () => {
    const takes = (await takesOf('inn')).takes
    expect(takes).toHaveLength(2)
    const had: string[] = []

    // One take and then the other: the game has whichever was chosen last.
    for (const { n } of [takes[1]!, takes[0]!]) {
      // The take the person looks at, as the model painted it.
      const shown = await page.get(`/api/images/inn/takes/${n}`)
      const [painted] = coloursOf(new Uint8Array(await shown.arrayBuffer()))
      const expected = PAINTS.find((paint) => paint.painted === painted)!.inPalette

      const chosen = await page.send('POST', '/api/images/inn/choose', { n })
      expect(chosen.status).toBe(200)

      const picture = new Uint8Array(readFileSync(join(root, 'web/images/inn.png')))
      expect(decodePng(picture)).toMatchObject({ width: 90, height: 60 })
      expect(coloursOf(picture)).toEqual([expected])
      had.push(expected)
      expect(JSON.parse(readFileSync(join(root, 'web/images/manifest.json'), 'utf8'))).toEqual({
        inn: { file: 'inn.png', width: 90, height: 60 },
      })
      expect((await rows())[0]).toMatchObject({ status: 'chosen', chosen: { take: n } })
    }
    // The two takes are different pictures, so the second choice did replace the first.
    expect(new Set(had).size).toBe(2)

    const other = (await takesOf('well')).takes[0]!
    expect((await page.send('POST', '/api/images/well/choose', { n: other.n })).status).toBe(200)

    const picture = new Uint8Array(readFileSync(join(root, 'web/images/well.png')))
    expect(decodePng(picture)).toMatchObject({ width: 50, height: 70 })
    expect(PALETTE).toEqual(expect.arrayContaining(coloursOf(picture)))
  })

  it('changes only the images’ pictures and manifest and the studio’s own files', () => {
    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()

    expect(changed).toEqual([
      'content-studio/images/edits.json',
      'content-studio/images/lock.json',
      'web/images/inn.png',
      'web/images/manifest.json',
      'web/images/well.png',
    ])
  })
})
