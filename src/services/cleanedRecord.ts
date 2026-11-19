import { rm, rmdir } from 'node:fs/promises'
import type { Cleaned } from '../core/cleanedLines'
import { resolveInRoot } from '../core/paths'
import { formatEntriesPerLine, writeAtomic } from './files'

/**
 * Saves a part's record of cleaned lines, then removes the originals kept for `forgotten` keys (in
 * that order, so a failed save never loses an original a record still lists). A record with no
 * lines is not kept: the file goes, and the folder of the originals with it once it is empty, so
 * putting every line back leaves nothing new in the game's repository.
 */
export async function saveCleaned(
  root: string,
  paths: { cleanedPath: string; originalsPath: string },
  cleaned: Cleaned,
  forgotten: string[] = [],
): Promise<void> {
  const empty = Object.keys(cleaned).length === 0
  if (empty) await rm(resolveInRoot(root, paths.cleanedPath), { force: true })
  else await writeAtomic(root, paths.cleanedPath, formatEntriesPerLine(cleaned))
  for (const key of forgotten) {
    await rm(resolveInRoot(root, `${paths.originalsPath}/${key}.mp3`), { force: true })
  }
  if (!empty) return
  // Only an empty folder goes; anything else in it stays.
  await rmdir(resolveInRoot(root, paths.originalsPath)).catch(() => {})
}
