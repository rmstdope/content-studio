import { randomUUID } from 'node:crypto'
import { copyFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LEVEL, levelDb, lineFailure, lineLevel } from '../core/level'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { LockSchema } from '../core/resources'
import { gainClip } from './audio'
import { formatLock, readResource, writeOrRefuse } from './files'
import type { LineResult } from './cleanLines'
import { inPartTurn } from './partFiles'
import { readPart } from './workspace'

/** What is replaced in tests: the gain behind setting a line's level. */
export interface LevelDeps {
  gain?: typeof gainClip
}

/**
 * Sets one line's clip in the game to `level` percent (§8.4): the clip is raised or lowered by the
 * gain from the level it is at (its lock entry's `level`, 100 when none) to the new one, in a
 * hidden temporary file in the clips folder renamed over the clip, and the lock entry notes the
 * level (no key at 100). In the part's turn. A clip already at the level is left alone; a failure
 * leaves the clip and the lock as they were. The manifest is untouched: a gain does not change the
 * length.
 */
export async function levelLine(
  projectFile: string,
  partId: string,
  language: string | undefined,
  key: string,
  level: number,
  { gain = gainClip }: LevelDeps = {},
): Promise<LineResult> {
  const root = dirname(projectFile)
  return inPartTurn(projectFile, partId, async (): Promise<LineResult> => {
    const read = await readPart(projectFile, partId, language)
    if (!read || !read.ok) return { ok: false, message: `Line ${key}: the part could not be read.` }
    const problems: Problem[] = []
    const lock = await readResource(root, read.paths.lockPath, LockSchema, problems)
    const file = read.input.manifest[key]?.file
    if (lock === 'invalid' || lock === 'missing') {
      return { ok: false, message: problems[0]?.message ?? 'The line has no clip in the game.' }
    }
    const entry = lock[key]
    if (!file || !entry || !read.input.files.has(file)) {
      return { ok: false, message: `Line ${key}: the line has no clip in the game.` }
    }
    const was = lineLevel(entry)
    if (was === level) return { ok: true }
    const clip = resolveInRoot(root, join(read.paths.clipsPath, file))
    const temporary = resolveInRoot(root, join(read.paths.clipsPath, `.${key}.${randomUUID()}.mp3`))
    try {
      await copyFile(clip, temporary)
      await gain(temporary, levelDb(level) - levelDb(was))
      const { level: _was, ...rest } = entry
      lock[key] = level === LEVEL.default ? rest : { ...rest, level }
      // The lock first: if the clip cannot then be put in place, the lock is put back, so the
      // next run never raises a clip that already has the gain.
      await writeOrRefuse(root, read.paths.lockPath, formatLock(lock))
      try {
        await rename(temporary, clip)
      } catch (error) {
        lock[key] = entry
        await writeOrRefuse(root, read.paths.lockPath, formatLock(lock)).catch(() => {})
        throw error
      }
      return { ok: true }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      return { ok: false, message: lineFailure(key, error) }
    }
  })
}
