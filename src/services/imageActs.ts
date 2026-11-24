import { dirname } from 'node:path'
import { actImageReport } from '../core/images'
import { readImages } from './imageLists'
import { openProject } from './workspace'

/**
 * One act's images as an agent reads them (`actImageReport`), read fresh from disk. Null when the
 * project cannot be opened, has no `images` section or has no such act.
 */
export async function readActImages(
  projectFile: string,
  actId: string,
): Promise<ReturnType<typeof actImageReport> | null> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return null
  const summary = await readImages(dirname(projectFile), opened.project, [])
  const act = summary?.acts.find((a) => a.id === actId)
  return act ? actImageReport(act) : null
}
