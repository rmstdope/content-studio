import { join } from 'node:path'
import type { Look } from '../core/imageLook'
import {
  choiceOn,
  gamePatch,
  layerPatch,
  PatchBoardSchema,
  stackOf,
  type PatchBoard,
} from '../core/imagePatches'
import type { Pixels } from '../core/imagePixels'
import type { ImageRow } from '../core/images'
import { resolveInRoot } from '../core/paths'
import { CACHE_DIR, type Problem } from '../core/project'
import { readResource, writeOrRefuse } from './files'
import { IMAGE_TAKES_DIR } from './imageLists'
import { boardQueue } from './musicTakes'
import { decodePng, encodeTransparentPng } from './png'
import type { ProjectFailure } from './workspace'

/** The folder of a patch's takes: the studio's cache, never committed and never read by the game. */
export const patchFolder = (image: string, patch: string) =>
  `${CACHE_DIR}/image-patches/${image}/${patch}`

/** A patch take's picture as the model made it, kept inside the marked area, relative to the project root. */
export const patchPictureOf = (image: string, patch: string, n: number) =>
  `${patchFolder(image, patch)}/${n}.png`

/** A patch take's game version: the transparent picture at the game's size, beside the take. */
export const patchGameOf = (image: string, patch: string, n: number) =>
  `${patchFolder(image, patch)}/${n}.game.png`

/** The patch picture the game reads, in the clips folder beside the image's own: `<image>.<patch>.png`. */
export const patchClipName = (image: string, patch: string) => `${image}.${patch}.png`

/** A patch's id in the take engine: its image and itself. */
export const patchEngineId = (image: string, patch: string) => `${image}\0${patch}`

/**
 * The queue key of a patch's board, so that every change to it goes one after another: the take
 * engine's own key for the patch's id, so the engine's turns and these share one queue.
 */
export const patchBoardKey = (projectFile: string, image: string, patch: string) =>
  `${projectFile}\0${patchEngineId(image, patch)}`

/** A patch's board as it is: empty when there is none; the failure when it cannot be read. */
export async function readPatchBoard(
  root: string,
  image: string,
  patch: string,
): Promise<PatchBoard | ProjectFailure> {
  const file = `${patchFolder(image, patch)}/board.json`
  const problems: Problem[] = []
  const board = await readResource(root, file, PatchBoardSchema, problems)
  if (board === 'missing') return PatchBoardSchema.parse({})
  if (board === 'invalid') return { ok: false, file, problems }
  return board
}

/** A patch board as it is written to its `board.json`. */
export const boardText = (board: PatchBoard) => `${JSON.stringify(board, null, 2)}\n`

/** Reads a patch's board in its turn, lets `change` alter it and writes it back if it differs. */
export function changePatchBoard<T>(
  where: { projectFile: string; root: string; image: string; patch: string },
  change: (board: PatchBoard) => T | Promise<T>,
): Promise<T | ProjectFailure> {
  const { projectFile, root, image, patch } = where
  return boardQueue().run(patchBoardKey(projectFile, image, patch), async () => {
    const board = await readPatchBoard(root, image, patch)
    if ('ok' in board) return board
    const before = JSON.stringify(board, null, 2)
    const answer = await change(board)
    const after = JSON.stringify(board, null, 2)
    if (after !== before) {
      await writeOrRefuse(root, `${patchFolder(image, patch)}/board.json`, boardText(board))
    }
    return answer
  })
}

/**
 * Makes a patch take's game version: the image take it was painted on and the take's picture,
 * both brought to the look, keeping the dots that differ (`gamePatch`). Writes it beside the take
 * and returns the PNG, or the sentence saying why not ('missing' when a picture is gone).
 */
export async function renderPatchGame(
  where: { root: string; image: string; patch: string; base: number; n: number },
  look: Look,
  size: { width: number; height: number },
): Promise<Uint8Array | { error: string }> {
  const { root, image, patch, base, n } = where
  let take: Pixels
  let picture: Uint8Array
  try {
    const board = await readPatchBoard(root, image, patch)
    // Never against the bare take when the board that says what it lies on cannot be read.
    if ('ok' in board) return { error: 'missing' }
    const under = board.takes.find((t) => t.n === n)?.under
    take = await laidPicture(root, image, base, under)
    picture = await Bun.file(resolveInRoot(root, patchPictureOf(image, patch, n))).bytes()
  } catch {
    return { error: 'missing' }
  }
  try {
    const png = encodeTransparentPng(gamePatch(take, decodePng(picture), look, size))
    await writeOrRefuse(root, patchGameOf(image, patch, n), png)
    return png
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The picture a patch take is painted on (as-evwv): the image's take with, when the patch lies on
 * top of another, that patch's take laid over it, and whatever that one lies on beneath it in
 * turn. Throws when a picture is missing.
 */
export async function laidPicture(
  root: string,
  image: string,
  base: number,
  under: { patch: string; n: number } | undefined,
): Promise<Pixels> {
  const chain: { patch: string; n: number }[] = []
  for (let at = under; at;) {
    chain.unshift(at)
    const board = await readPatchBoard(root, image, at.patch)
    if ('ok' in board) throw new Error('board')
    at = board.takes.find((t) => t.n === at!.n)?.under
  }
  let pixels = decodePng(
    await Bun.file(resolveInRoot(root, `${IMAGE_TAKES_DIR}/${image}/${base}.png`)).bytes(),
  )
  for (const { patch, n } of chain) {
    const laid = decodePng(
      await Bun.file(resolveInRoot(root, patchPictureOf(image, patch, n))).bytes(),
    )
    pixels = layerPatch(pixels, laid)
  }
  return pixels
}

/** One patch of an image as the game's manifest lists it. */
export interface ManifestPatch {
  file: string
  width: number
  height: number
}

/**
 * The patches the game gets with take `base` of the image: those with a take in the game on it
 * (`inGame`) whose game version is stored. Their pictures are written to the clips folder from the
 * stored versions (one name per patch is shared by every take of the image), and the manifest's
 * entries are returned in patch id order; empty when there are none.
 */
export async function patchesInGame(
  image: {
    root: string
    clips: string
    row: Pick<ImageRow, 'id' | 'width' | 'height' | 'patches'>
  },
  base: number,
): Promise<Record<string, ManifestPatch>> {
  const { root, clips, row } = image
  const entries: Record<string, ManifestPatch> = {}
  const boards = await boardsOf(root, row)
  for (const patch of [...row.patches].sort((a, b) => a.id.localeCompare(b.id))) {
    const board = boards[patch.id]
    if (!board) continue
    const n = board.inGame[String(base)]
    // A patch on top of another is in the game only while it lies on what is underneath.
    if (n === undefined || !choiceOn(row.patches, boards, patch.id, base)?.valid) continue
    const png = await Bun.file(resolveInRoot(root, patchGameOf(row.id, patch.id, n)))
      .bytes()
      .catch(() => null)
    if (!png) continue
    const file = patchClipName(row.id, patch.id)
    await writeOrRefuse(root, join(clips, file), png)
    entries[patch.id] = { file, width: row.width, height: row.height }
  }
  return entries
}

/** The boards of an image's patches that can be read, by patch id. */
async function boardsOf(
  root: string,
  row: Pick<ImageRow, 'id' | 'patches'>,
): Promise<Record<string, PatchBoard>> {
  const boards: Record<string, PatchBoard> = {}
  for (const patch of row.patches) {
    const board = await readPatchBoard(root, row.id, patch.id)
    if (!('ok' in board)) boards[patch.id] = board
  }
  return boards
}

/**
 * What a change of a patch's chosen take does to the patches lying on top of it (as-evwv): given
 * its board as it will be, those that still lie on what is underneath, with their pictures
 * written to the clips folder from their stored game versions, and those that no longer do and
 * must leave the manifest.
 */
export async function restack(
  image: {
    root: string
    clips: string
    row: Pick<ImageRow, 'id' | 'width' | 'height' | 'patches'>
  },
  base: number,
  patch: string,
  board: PatchBoard,
): Promise<{ add: Record<string, ManifestPatch>; gone: string[] }> {
  const { root, clips, row } = image
  const boards = { ...(await boardsOf(root, row)), [patch]: board }
  const add: Record<string, ManifestPatch> = {}
  const gone: string[] = []
  for (const on of row.patches) {
    const stack = stackOf(row.patches, on.id)
    if (!stack.ok || !stack.under.some((u) => u.id === patch)) continue
    const n = boards[on.id]?.inGame[String(base)]
    const png =
      n !== undefined && choiceOn(row.patches, boards, on.id, base)?.valid
        ? await Bun.file(resolveInRoot(root, patchGameOf(row.id, on.id, n)))
            .bytes()
            .catch(() => null)
        : null
    if (!png) {
      gone.push(on.id)
      continue
    }
    const file = patchClipName(row.id, on.id)
    await writeOrRefuse(root, join(clips, file), png)
    add[on.id] = { file, width: row.width, height: row.height }
  }
  return { add, gone }
}
