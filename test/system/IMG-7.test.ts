// IMG-7: when the act's look changes, the chosen pictures and their patches can be brought to the
// new look, and the studio says which could not be. The look is the style's colours, which the
// person changes in the images edits file: no page edits them.
import { describe, expect, it, setDefaultTimeout } from 'bun:test'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImagePatchesView } from '../../src/core/imagePatches'
import type { ImageTakesView, LookRunView } from '../../src/core/imageTakes'
import type { ProjectSummary } from '../../src/core/summary'
import type { ImageRequest } from '../../src/services/images'
import { createFakeImages } from '../../src/services/imagesFake'
import { decodePng, encodePng } from '../../src/services/png'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** The game's colours before and after: what the model paints red and blue becomes in each. */
const OLD = { colours: ['#101010', '#e00000', '#0000e0', '#f0f0f0'], red: '#e00000' }
const NEW = { colours: ['#202020', '#c08000', '#008080', '#d0d0d0'], red: '#c08000' }
const OLD_BLUE = '#0000e0'
const NEW_BLUE = '#008080'

/** What the model paints: a picture is all red, and an edit turns the marked middle blue. */
const RED = [244, 12, 12, 255]
const BLUE = [12, 12, 244, 255]
/** The marked area, in the take's pixels. */
const MARK = { x: 32, y: 16, width: 32, height: 32 }

/** A picture of one colour, as the model gives it. */
function painting(width: number, height: number) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(RED, i)
  return encodePng({ width, height, data })
}

/** The picture given to edit, with the marked area painted over. The picture is small, so it is given whole. */
function edited(path: string) {
  const picture = decodePng(new Uint8Array(readFileSync(path)))
  for (let y = MARK.y; y < MARK.y + MARK.height; y++) {
    for (let x = MARK.x; x < MARK.x + MARK.width; x++) {
      picture.data.set(BLUE, (y * picture.width + x) * 4)
    }
  }
  return encodePng(picture)
}

describe('IMG-7: the chosen pictures and their patches are brought to the new look', () => {
  setDefaultTimeout(30_000)

  /** What the local model was asked for, in turn. */
  const asked: ImageRequest[] = []
  // Sizes the model makes as they are, so no edge of a patch is a blend of two colours.
  const image = (id: string, title: string) => ({
    id,
    title,
    text: `A ${id}`,
    width: 96,
    height: 64,
  })
  const style = (palette: string[]) => ({
    style: { look: 'Flat pixel art', palette, dithering: 'flat' },
    images: {},
  })
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
          ...image('inn', 'Inn'),
          patches: [{ id: 'door', title: 'Open door', text: 'The door stands open' }],
        },
        image('mill', 'Mill'),
      ],
      'tts/act2/images.json': [image('well', 'Well')],
      'content-studio/images/edits.json': style(OLD.colours),
    },
    {
      images: {
        ...createFakeImages(0),
        generate: async (request) => {
          asked.push(request)
          const png = request.editing
            ? edited(request.editing)
            : painting(request.width, request.height)
          return { png, seed: request.seed }
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

  /** A picture in the game: its size, the colours that show, and whether any of it is see-through. */
  function inGame(file: string) {
    const { width, height, data } = decodePng(
      new Uint8Array(readFileSync(join(root, 'web/images', file))),
    )
    const colours = new Set<string>()
    let seeThrough = false
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) seeThrough = true
      else colours.add(`#${Buffer.from(data.subarray(i, i + 3)).toString('hex')}`)
    }
    return { width, height, colours: [...colours], seeThrough }
  }
  const manifest = () =>
    JSON.parse(readFileSync(join(root, 'web/images/manifest.json'), 'utf8')) as unknown

  const read = async <T>(path: string) => (await (await page.get(path)).json()) as T

  /** What the Images pages show: the notice of a changed look, and the images that have the old one. */
  async function looks() {
    const { summary } = await read<{ summary: ProjectSummary }>('/api/project')
    const { acts, lookNotice } = summary.images!
    return {
      notice: lookNotice,
      old: acts.flatMap((act) => act.rows.filter((row) => row.looksOld).map((row) => row.id)),
    }
  }

  /** A change the page asks for, which must be taken. */
  async function send(path: string, body?: unknown) {
    expect((await page.send('POST', path, body)).status).toBe(200)
  }

  /** Asks as the page does until `ready` holds. */
  async function until(what: string, ready: () => Promise<boolean>) {
    for (const giveUp = Date.now() + 20_000; !(await ready());) {
      if (Date.now() > giveUp) throw new Error(`${what} never came`)
      await Bun.sleep(10)
    }
  }

  const everything = {
    inn: {
      file: 'inn.png',
      width: 96,
      height: 64,
      patches: { door: { file: 'inn.door.png', width: 96, height: 64 } },
    },
    mill: { file: 'mill.png', width: 96, height: 64 },
    well: { file: 'well.png', width: 96, height: 64 },
  }

  it('says which images have the old look once the look changes, leaving the game as it was', async () => {
    for (const id of ['inn', 'mill', 'well']) {
      await send(`/api/images/${id}/takes`, { count: 1 })
      await until(`the take of ${id}`, async () => {
        const view = await read<ImageTakesView>(`/api/images/${id}/takes`)
        expect(view.failed).toEqual([])
        return view.takes[0]?.look === 'ready'
      })
      await send(`/api/images/${id}/choose`, { n: 1 })
    }
    await send('/api/images/inn/patches/door/takes', { count: 1, area: MARK })
    await until('the take of the patch', async () => {
      const view = await read<ImagePatchesView>('/api/images/inn/patches')
      const door = view.patches[0]!
      expect(door.failed).toEqual([])
      return door.takes[0]?.look === 'ready'
    })
    await send('/api/images/inn/patches/door/choose', { n: 1 })

    expect(manifest()).toEqual(everything)
    for (const id of ['inn', 'mill', 'well']) {
      expect(inGame(`${id}.png`).colours).toEqual([OLD.red])
    }
    expect(inGame('inn.door.png')).toMatchObject({ colours: [OLD_BLUE], seeThrough: true })
    expect(await looks()).toEqual({ notice: null, old: [] })

    const before = game()
    writeFileSync(
      join(root, 'content-studio/images/edits.json'),
      JSON.stringify(style(NEW.colours)),
    )

    expect(await looks()).toEqual({
      notice: { count: 3, changed: ['its palette'] },
      old: ['inn', 'mill', 'well'],
    })
    const after = game()
    delete before['content-studio/images/edits.json']
    delete after['content-studio/images/edits.json']
    expect(after).toEqual(before)
  })

  it('brings the chosen pictures and their patches to the new look, and says which could not be', async () => {
    // The model's picture of one chosen take is lost, so there is nothing to bring it from.
    rmSync(join(root, 'content-studio/cache/image-takes/mill/1.png'))
    const before = game()
    const made = asked.length

    await send('/api/images/bring-all')
    let run: LookRunView | null = null
    await until('the end of the bringing', async () => {
      run = await read<LookRunView | null>('/api/images/bring-all')
      // A run with nothing left to say is gone.
      return !run?.running
    })

    expect(run!).toEqual({
      running: false,
      total: 3,
      done: 3,
      failed: [{ id: 'mill', reason: 'missing' }],
    })
    for (const id of ['inn', 'well']) {
      expect(inGame(`${id}.png`)).toEqual({
        width: 96,
        height: 64,
        colours: [NEW.red],
        seeThrough: false,
      })
    }
    expect(inGame('inn.door.png')).toEqual({
      width: 96,
      height: 64,
      colours: [NEW_BLUE],
      seeThrough: true,
    })
    expect(manifest()).toEqual(everything)
    expect(await looks()).toEqual({
      notice: { count: 1, changed: ['its palette'] },
      old: ['mill'],
    })
    // Brought from the pictures the studio kept: nothing was made again.
    expect(asked).toHaveLength(made)

    const after = game()
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((path) => before[path] !== after[path])
      .sort()
    expect(changed).toEqual([
      'content-studio/images/lock.json',
      'web/images/inn.door.png',
      'web/images/inn.png',
      'web/images/well.png',
    ])
  })
})
