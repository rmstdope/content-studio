import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { CLEANUP } from '../core/cleanup'
import { levelDb, lineLevel } from '../core/level'
import { resolveInRoot } from '../core/paths'
import { CACHE_DIR } from '../core/project'
import { decodeClip, ffmpegEncoder, type Encoder } from './audio'
import { takeFile } from './takes'
import { clipFile, openProject, readPart } from './workspace'

/** Where the cleaned copies made for hearing are kept, in the tool cache. */
export const CLEANED_DIR = `${CACHE_DIR}/cleaned`

/** What a cleaned copy is made from: a recorded line of a part, or a character's take. */
export type CleanSource = { part: string; file: string } | { take: string }

/** The copy's file name in the cache, or why it could not be made (ffmpeg's own reason). Null for no such source. */
export type CleanedCopy = { ok: true; name: string } | { ok: false; message: string } | null

/**
 * The same clip, cleaned of background noise as a switched-on voice's new lines are, to hear it
 * beside the original (§8.4). Encoded as the project encodes (its bitrate, channels and
 * loudness), into the cache only: the game's clip is never touched. Named by what it was made
 * from (the clip's place, size and time, and the chain's version), so a copy is made once and
 * again only when the clip or the chain changes. Null for a clip or take that is not there.
 */
export async function cleanedCopy(
  projectFile: string,
  source: CleanSource,
  {
    encode = ffmpegEncoder,
    decode = decodeClip,
    language,
  }: { encode?: Encoder; decode?: typeof decodeClip; language?: string } = {},
): Promise<CleanedCopy> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return { ok: false, message: 'The project file could not be read.' }
  const root = dirname(projectFile)
  const file =
    'take' in source
      ? await takeFile(projectFile, source.take)
      : await clipFile(projectFile, source.part, source.file, language)
  if (!file) return null
  const { size, mtimeMs } = await stat(file)
  const name = `${createHash('sha256')
    .update(JSON.stringify([CLEANUP.version, relative(root, file), size, mtimeMs]))
    .digest('hex')
    .slice(0, 16)}.mp3`
  const target = resolveInRoot(root, join(CLEANED_DIR, name))
  if (existsSync(target)) return { ok: true, name }
  const temporary = resolveInRoot(root, join(CLEANED_DIR, `.${name}.${randomUUID()}.mp3`))
  try {
    await mkdir(dirname(target), { recursive: true })
    const { wav } = await decode(file)
    // A take is heard as it was recorded, never levelled, so its copy is not levelled either:
    // only the noise differs. A game clip is levelled already, and levelling it again is a no-op.
    const output = opened.project.narration.output
    // A game clip has its voice's level: levelling to the project's target takes it off, so it is put on again.
    const read =
      'part' in source && output.lufs !== null
        ? await readPart(projectFile, source.part, language)
        : null
    // The line is the one whose manifest entry names the clip: an adopted clip's file need not be its key.
    const key =
      read?.ok && 'part' in source
        ? Object.keys(read.input.manifest).find((k) => read.input.manifest[k]?.file === source.file)
        : undefined
    const level = lineLevel(key && read?.ok ? read.input.lock[key] : undefined)
    await encode(wav, temporary, {
      ...output,
      ...('take' in source ? { lufs: null } : {}),
      clean: true,
      gainDb: levelDb(level),
    })
    await rename(temporary, target)
    return { ok: true, name }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    // A folder made only for this copy is not left empty.
    await rmdir(dirname(target)).catch(() => {})
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** The file of a cleaned copy by its name, or null for any name that is not one of ours. */
export async function cleanedFile(projectFile: string, name: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}\.mp3$/.test(name)) return null
  const file = resolveInRoot(dirname(projectFile), join(CLEANED_DIR, name))
  return existsSync(file) ? file : null
}
