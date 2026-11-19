import { rm, rmdir } from 'node:fs/promises'
import type { Cleaned } from '../core/cleanedLines'
import { resolveInRoot } from '../core/paths'
import { formatEntriesPerLine, writeAtomic } from './files'

/**
 * Saves a part's record of cleaned lines. A record with no lines is not kept: the file goes, and
 * the folder of the originals with it once it is empty, so putting every line back leaves nothing
 * new in the game's repository. Call it after the originals it no longer lists are removed.
 */
export async function saveCleaned(
  root: string,
  paths: { cleanedPath: string; originalsPath: string },
  cleaned: Cleaned,
): Promise<void> {
  if (Object.keys(cleaned).length > 0) {
    await writeAtomic(root, paths.cleanedPath, formatEntriesPerLine(cleaned))
    return
  }
  await rm(resolveInRoot(root, paths.cleanedPath), { force: true })
  // Only an empty folder goes; anything else in it stays.
  await rmdir(resolveInRoot(root, paths.originalsPath)).catch(() => {})
}
