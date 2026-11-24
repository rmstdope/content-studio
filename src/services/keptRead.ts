import { keptBox, type PatchArea } from '../core/imagePatches'
import { changeOf, type TakeChange } from '../core/imageSmallMark'
import { resolveInRoot } from '../core/paths'
import { decodePng } from './png'

/** What a take's picture keeps: the box round it, and whether that is nothing or a few specks. */
export interface KeptRead {
  kept: PatchArea | null
  /** Absent when the take changed something, or its picture cannot be read. */
  changed?: TakeChange
}

/** Reads what the take at a path keeps, by project root and path, with the file's time and size it was read at. */
export type ReadKept = (root: string, path: string) => Promise<KeptRead>

/**
 * A reader of what take files keep (`keptBox`, `changeOf`), reading a file again only when its
 * time or size changed; an unreadable file keeps nothing and is not flagged.
 */
export function createKeptReader(): ReadKept {
  const known = new Map<string, { key: string; read: KeptRead }>()
  return async (root, path) => {
    try {
      const file = Bun.file(resolveInRoot(root, path))
      const key = `${file.lastModified}:${file.size}`
      const had = known.get(`${root}\0${path}`)
      if (had?.key === key) return had.read
      const pixels = decodePng(new Uint8Array(await file.arrayBuffer()))
      const changed = changeOf(pixels)
      const read: KeptRead = { kept: keptBox(pixels), ...(changed && { changed }) }
      known.set(`${root}\0${path}`, { key, read })
      return read
    } catch {
      return { kept: null }
    }
  }
}
