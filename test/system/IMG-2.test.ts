// IMG-2: patches: the person marks part of a chosen picture and has a change painted into it,
// compares the patch's takes and chooses one for the game.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ImagePatchesView, PatchArea } from '../../src/core/imagePatches'
import type { ImageTakesView } from '../../src/core/imageTakes'
import type { ImageRequest } from '../../src/services/images'
import { createFakeImages } from '../../src/services/imagesFake'
import { decodePng, encodePng } from '../../src/services/png'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** The game's palette. */
const PALETTE = ['#101010', '#e00000', '#0000e0', '#f0f0f0']

/** What the fake model paints a new picture with: red in the palette. */
const PICTURE = '#f40c0c'

/** What the fake edit model paints into the picture, one colour per take, and its palette colour. */
const CHANGES = [
  { painted: '#0c0cf4', inPalette: '#0000e0' },
  { painted: '#f4f4f4', inPalette: '#f0f0f0' },
]

/** The side of the square the fake edit model paints, in the middle of what it is given. */
const PAINTED_SIDE = 96

/** The part of the picture the person marks: up and to the left, so the middle is outside it. */
const MARK: PatchArea = { x: 160, y: 128, width: 160, height: 160 }

/** A box of pixels, its right and bottom edges not included. */
interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The colour at a place of a decoded picture, as `#rrggbb`, and none where it is transparent. */
function dotAt({ width, data }: { width: number; data: Uint8Array }, x: number, y: number) {
  const i = (y * width + x) * 4
  return data[i + 3] === 0 ? null : `#${Buffer.from(data.subarray(i, i + 3)).toString('hex')}`
}

/** What a picture shows: its size, the colours it has, and the box round all it does not leave clear. */
function lookOf(png: Uint8Array) {
  const picture = decodePng(png)
  const { width, height } = picture
  const colours = new Set<string>()
  const box: Box = { left: width, top: height, right: 0, bottom: 0 }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = dotAt(picture, x, y)
      if (colour === null) continue
      colours.add(colour)
      box.left = Math.min(box.left, x)
      box.top = Math.min(box.top, y)
      box.right = Math.max(box.right, x + 1)
      box.bottom = Math.max(box.bottom, y + 1)
    }
  }
  return {
    width,
    height,
    colours: [...colours],
    box,
    at: (x: number, y: number) => dotAt(picture, x, y),
  }
}

/** A picture of one colour with, if asked, a square of another in its middle. */
function painting(width: number, height: number, colour: string, middle?: string) {
  const data = new Uint8Array(width * height * 4)
  const pixel = (hex: string) => [...Buffer.from(hex.slice(1), 'hex'), 255]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inMiddle =
        Math.abs(x + 0.5 - width / 2) < PAINTED_SIDE / 2 &&
        Math.abs(y + 0.5 - height / 2) < PAINTED_SIDE / 2
      data.set(pixel(middle && inMiddle ? middle : colour), (y * width + x) * 4)
    }
  }
  return encodePng({ width, height, data })
}

describe('IMG-2: a change is painted into part of a picture, compared and chosen', () => {
  setDefaultTimeout(30_000)

  /** What the edit model was asked for, in turn, and the picture it was given to change. */
  const edits: { request: ImageRequest; given: ReturnType<typeof lookOf> }[] = []
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
        {
          id: 'inn',
          title: 'Inn',
          text: 'A low inn',
          width: 90,
          height: 60,
          patches: [{ id: 'sign', title: 'The sign', text: 'Hang a sign by the door' }],
        },
      ],
      'content-studio/images/edits.json': {
        style: { look: 'plain', palette: PALETTE },
        images: {},
      },
    },
    {
      images: {
        ...createFakeImages(0),
        generate: async (request) => {
          const { width, height, seed, editing } = request
          if (editing === undefined) return { png: painting(width, height, PICTURE), seed }
          const given = lookOf(new Uint8Array(readFileSync(editing)))
          const { painted } = CHANGES[(edits.push({ request, given }) - 1) % CHANGES.length]!
          return { png: painting(width, height, PICTURE, painted), seed }
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

  const inGame = (name: string) => new Uint8Array(readFileSync(join(root, 'web/images', name)))
  const manifest = () =>
    JSON.parse(readFileSync(join(root, 'web/images/manifest.json'), 'utf8')) as unknown

  const takesOf = async () =>
    (await (await page.get('/api/images/inn/takes')).json()) as ImageTakesView
  /** The patch as the Patches tab shows it, and the picture it lies over. */
  async function patches() {
    const view = (await (await page.get('/api/images/inn/patches')).json()) as ImagePatchesView
    return { chosen: view.chosen, patch: view.patches[0]! }
  }

  /** A picture the page shows, which must be there. */
  async function shown(path: string) {
    const answer = await page.get(path)
    expect(answer.status).toBe(200)
    return lookOf(new Uint8Array(await answer.arrayBuffer()))
  }

  /** A change the page asks for, which must be taken. */
  async function send(method: string, path: string, body?: unknown) {
    const answer = await page.send(method, path, body)
    expect(answer.status).toBe(200)
  }

  /** Asks as the page does until `ready` holds. */
  async function until(what: string, ready: () => Promise<boolean>) {
    for (const giveUp = Date.now() + 20_000; !(await ready());) {
      if (Date.now() > giveUp) throw new Error(`${what} never came`)
      await Bun.sleep(10)
    }
  }

  /** The picture the game has once the image's take is chosen, and the size of that take. */
  let chosen: { picture: ReturnType<typeof inGame>; width: number; height: number }

  it('paints the change the game asks for into the marked part of the chosen picture', async () => {
    await send('POST', '/api/images/inn/takes', { count: 1 })
    await until('the picture', async () => (await takesOf()).takes[0]?.look === 'ready')
    await send('POST', '/api/images/inn/choose', { n: 1 })
    const view = await patches()
    if (!view.chosen.known || !view.chosen.take) throw new Error('no picture to patch')
    chosen = { picture: inGame('inn.png'), ...view.chosen.take }
    const before = manifest()

    await send('POST', '/api/images/inn/patches/sign/takes', { count: 2, area: MARK })
    await until('the takes', async () => {
      const { patch } = await patches()
      expect(patch.failed).toEqual([])
      return patch.takes.length === 2 && patch.takes.every((take) => take.look === 'ready')
    })

    // The model changed a part of the chosen picture, from the patch's words.
    expect(edits.map(({ request }) => request.prompt)).toEqual(
      Array(2).fill('Hang a sign by the door'),
    )
    for (const { given } of edits) {
      expect(given.colours).toEqual([PICTURE])
      expect(given.width).toBeLessThan(chosen.width)
      expect(given.height).toBeLessThan(chosen.height)
    }
    expect(inGame('inn.png')).toEqual(chosen.picture)
    expect(manifest()).toEqual(before)
  })

  it('shows each take of the patch over the picture, to compare', async () => {
    const { patch } = await patches()
    expect(patch.takes.map((take) => [take.n, take.area, take.isNew])).toEqual([
      [1, MARK, true],
      [2, MARK, true],
    ])
    const painted: string[] = []
    for (const { n } of patch.takes) {
      // As big as the picture it lies over, and clear but for the change inside the mark.
      const take = await shown(`/api/images/inn/patches/sign/takes/${n}`)
      expect(take).toMatchObject({ width: chosen.width, height: chosen.height })
      expect(take.box.left).toBeGreaterThanOrEqual(MARK.x)
      expect(take.box.top).toBeGreaterThanOrEqual(MARK.y)
      expect(take.box.right).toBeLessThanOrEqual(MARK.x + MARK.width)
      expect(take.box.bottom).toBeLessThanOrEqual(MARK.y + MARK.height)
      painted.push(take.at(MARK.x + MARK.width / 2, MARK.y + MARK.height / 2)!)
      await send('POST', `/api/images/inn/patches/sign/takes/${n}/seen`)
    }
    expect(painted.sort()).toEqual(CHANGES.map((change) => change.painted).sort())
    expect((await patches()).patch.takes.map((take) => take.isNew)).toEqual([false, false])
  })

  it('gives the game the take the person chooses, laid over the picture where they marked', async () => {
    const had: string[] = []
    // One take and then the other: the game has whichever was chosen last.
    for (const n of [2, 1]) {
      const take = await shown(`/api/images/inn/patches/sign/takes/${n}`)
      const painted = take.at(MARK.x + MARK.width / 2, MARK.y + MARK.height / 2)
      const expected = CHANGES.find((change) => change.painted === painted)!.inPalette
      // What the page shows as what the game gets.
      const offered = await shown(`/api/images/inn/patches/sign/takes/${n}/game`)

      await send('POST', '/api/images/inn/patches/sign/choose', { n })

      const patch = lookOf(inGame('inn.sign.png'))
      expect(patch).toMatchObject({ width: 90, height: 60 })
      expect(patch.colours.length).toBeGreaterThan(0)
      expect(PALETTE).toEqual(expect.arrayContaining(patch.colours))
      expect(patch.box).toEqual(offered.box)
      // The mark's place at the game's size: the picture is scaled to cover it, and cut evenly.
      const scale = Math.max(90 / chosen.width, 60 / chosen.height)
      const cut = { x: (chosen.width * scale - 90) / 2, y: (chosen.height * scale - 60) / 2 }
      expect(patch.box.left).toBeGreaterThanOrEqual(Math.floor(MARK.x * scale - cut.x))
      expect(patch.box.top).toBeGreaterThanOrEqual(Math.floor(MARK.y * scale - cut.y))
      expect(patch.box.right).toBeLessThanOrEqual(Math.ceil((MARK.x + MARK.width) * scale - cut.x))
      expect(patch.box.bottom).toBeLessThanOrEqual(
        Math.ceil((MARK.y + MARK.height) * scale - cut.y),
      )
      const middle = patch.at(
        Math.floor((MARK.x + MARK.width / 2) * scale - cut.x),
        Math.floor((MARK.y + MARK.height / 2) * scale - cut.y),
      )
      expect(middle).toBe(expected)
      had.push(expected)
      expect(manifest()).toEqual({
        inn: {
          file: 'inn.png',
          width: 90,
          height: 60,
          patches: { sign: { file: 'inn.sign.png', width: 90, height: 60 } },
        },
      })
      expect(inGame('inn.png')).toEqual(chosen.picture)
      expect((await patches()).patch.chosen).toEqual({ known: true, take: n })
    }
    // The two takes are different changes, so the second choice did replace the first.
    expect(new Set(had).size).toBe(2)
  })

  it('changes only the image’s pictures and manifest and the studio’s own files', () => {
    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()

    expect(changed).toEqual([
      'content-studio/images/lock.json',
      'web/images/inn.png',
      'web/images/inn.sign.png',
      'web/images/manifest.json',
    ])
  })
})
