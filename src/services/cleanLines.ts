import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { levelDb, lineFailure, lineLevel } from '../core/level'
import { CleanedSchema, isCleaned, originalFile, type Cleaned } from '../core/cleanedLines'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { LockSchema } from '../core/resources'
import { decodeClip, ffmpegEncoder, gainClip, type Encoder } from './audio'
import { saveCleaned } from './cleanedRecord'
import { formatEntriesPerLine, readResource, writeAtomic } from './files'
import { inPartTurn } from './partFiles'
import { openProject, readPart, type PartRead } from './workspace'

/** What cleaning, or putting back, one line gave: done, or why not (the reason as it is shown). */
export type LineResult = { ok: true } | { ok: false; message: string }

/** What is replaced in tests: the encoder and decoder behind the clean-up. */
export interface CleanDeps {
  encode?: Encoder
  decode?: typeof decodeClip
  /** Raises or lowers a clip in place (a voice's level). */
  gain?: typeof gainClip
}

/** A speaker's line in the game, and whether its clip is cleaned. */
export interface GameLine {
  part: string
  key: string
  /** The clip's file in the part's clips folder. */
  file: string
  cleaned: boolean
  /** How loud the clip is, in percent (100 unless its voice was given a level). */
  level: number
}

/**
 * The lines a speaker has in the game in `language`, part by part in dialog order: those with a
 * clip in the manifest, in the clips folder and in the lock. Takes that were not chosen are not
 * lines in the game, so they never appear here.
 */
export async function cleanedLinesOf(
  projectFile: string,
  speaker: string,
  language?: string,
): Promise<{ total: number; cleaned: number; lines: GameLine[]; problem: string | null }> {
  const opened = await readParts(projectFile, language)
  const lines: GameLine[] = []
  let problem: string | null = null
  for (const read of opened) {
    const found: Problem[] = []
    const cleaned = await cleanedNow(dirname(projectFile), read, found)
    if (!cleaned) problem ??= `${found[0]?.file}: ${found[0]?.message}`
    for (const line of read.input.lines) {
      if (line.speaker !== speaker) continue
      const file = read.input.manifest[line.key]?.file
      const lock = read.input.lock[line.key]
      if (!file || !lock || !read.input.files.has(file)) continue
      lines.push({
        part: read.part.id,
        key: line.key,
        file,
        cleaned: isCleaned(cleaned?.[line.key], lock),
        level: lineLevel(lock),
      })
    }
  }
  return { total: lines.length, cleaned: lines.filter((l) => l.cleaned).length, lines, problem }
}

/** Whether the speaker's clean-up is switched on in `language` (false when the project has no part to read it from). */
export async function voiceCleaned(
  projectFile: string,
  speaker: string,
  language?: string,
): Promise<boolean> {
  const [first] = await readParts(projectFile, language)
  return first?.input.cast.speakers[speaker]?.clean === true
}

/** Every part of the project, read in `language` (the parts the project cannot read are left out). */
async function readParts(projectFile: string, language?: string): Promise<PartRead[]> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return []
  const reads = await Promise.all(
    opened.project.parts.map((p) => readPart(projectFile, p.id, language)),
  )
  return reads.flatMap((r) => (r && r.ok ? [r] : []))
}

/** The part's record of cleaned lines as it is now: empty if there is none, null if it is broken. */
async function cleanedNow(
  root: string,
  read: PartRead,
  problems: Problem[],
): Promise<Cleaned | null> {
  const path = read.paths.cleanedPath
  const found = await readResource(root, path, CleanedSchema, problems)
  return found === 'invalid' ? null : found === 'missing' ? {} : found
}

/**
 * Cleans one line's clip in the game of its background noise (§8.4), keeping the original. In the
 * part's turn: the original is copied, the record written against the clip's lock time, and only
 * then the cleaned clip put in its place, so a failure part-way never loses the original. A clip
 * already cleaned is left as it is.
 */
export async function cleanLine(
  projectFile: string,
  partId: string,
  language: string | undefined,
  key: string,
  { encode = ffmpegEncoder, decode = decodeClip, gain = gainClip }: CleanDeps = {},
): Promise<LineResult> {
  const root = dirname(projectFile)
  return inPartTurn(projectFile, partId, async (): Promise<LineResult> => {
    const read = await readPart(projectFile, partId, language)
    if (!read || !read.ok) return { ok: false, message: `Line ${key}: the part could not be read.` }
    const problems: Problem[] = []
    const lock = await readResource(root, read.paths.lockPath, LockSchema, problems)
    const cleaned = await cleanedNow(root, read, problems)
    const file = read.input.manifest[key]?.file
    if (lock === 'invalid' || lock === 'missing' || !cleaned || problems.length) {
      return { ok: false, message: problems[0]?.message ?? 'The line has no clip in the game.' }
    }
    const entry = lock[key]
    if (!file || !entry)
      return { ok: false, message: `Line ${key}: the line has no clip in the game.` }
    if (isCleaned(cleaned[key], entry)) return { ok: true }
    const clip = resolveInRoot(root, join(read.paths.clipsPath, file))
    const temporary = resolveInRoot(root, join(read.paths.clipsPath, `.${key}.${randomUUID()}.mp3`))
    const level = lineLevel(entry)
    const output = read.project.narration.output
    const kept = originalFile(read.project, partId, read.language, key)
    try {
      // The original is kept at 100%: a clip at the voice's level is brought back up first.
      let original = new Uint8Array(await readFile(clip))
      if (level !== 100) {
        const copy = resolveInRoot(
          root,
          join(read.paths.clipsPath, `.${key}.${randomUUID()}.o.mp3`),
        )
        try {
          await Bun.write(copy, original)
          await gain(copy, -levelDb(level))
          original = new Uint8Array(await readFile(copy))
        } finally {
          await rm(copy, { force: true }).catch(() => {})
        }
      }
      const { wav } = await decode(clip)
      // Levelling to the project's target takes the voice's level off, so it is put on again; with
      // no target the clip decoded already has it.
      await encode(wav, temporary, {
        ...output,
        clean: true,
        gainDb: output.lufs === null ? 0 : levelDb(level),
      })
      await writeAtomic(root, kept, original)
      cleaned[key] = { at: entry.at, original: `${key}.mp3` }
      await writeAtomic(root, read.paths.cleanedPath, formatEntriesPerLine(cleaned))
      await rename(temporary, clip)
      return { ok: true }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      // A failure before the record was written leaves no copy behind either.
      if (!cleaned[key])
        await rm(resolveInRoot(root, originalFile(read.project, partId, read.language, key)), {
          force: true,
        }).catch(() => {})
      return { ok: false, message: lineFailure(key, error) }
    }
  })
}

/**
 * Puts one line's original back as its clip in the game and forgets the record and the kept copy.
 * A record whose clip was recorded again since is only forgotten: that clip is not the one cleaned,
 * and the old original must not replace it. Safe to repeat after a crash part-way.
 */
export async function putBackLine(
  projectFile: string,
  partId: string,
  language: string | undefined,
  key: string,
  { gain = gainClip }: CleanDeps = {},
): Promise<LineResult> {
  const root = dirname(projectFile)
  return inPartTurn(projectFile, partId, async (): Promise<LineResult> => {
    const read = await readPart(projectFile, partId, language)
    if (!read || !read.ok) return { ok: false, message: `Line ${key}: the part could not be read.` }
    const problems: Problem[] = []
    const lock = await readResource(root, read.paths.lockPath, LockSchema, problems)
    const cleaned = await cleanedNow(root, read, problems)
    if (!cleaned || lock === 'invalid' || problems.length) {
      return {
        ok: false,
        message: problems[0]?.message ?? 'The record of cleaned lines is broken.',
      }
    }
    const record = cleaned[key]
    if (!record) return { ok: true }
    const kept = resolveInRoot(root, originalFile(read.project, partId, read.language, key))
    const file = read.input.manifest[key]?.file
    const entry = lock === 'missing' ? undefined : lock[key]
    try {
      if (file && isCleaned(record, entry)) {
        if (!existsSync(kept))
          return { ok: false, message: `Line ${key}: the original of this line is missing.` }
        const clip = resolveInRoot(root, join(read.paths.clipsPath, file))
        const temporary = resolveInRoot(
          root,
          join(read.paths.clipsPath, `.${key}.${randomUUID()}.mp3`),
        )
        try {
          await Bun.write(temporary, Bun.file(kept))
          // The original is at 100%: the voice's level goes on it again.
          if (lineLevel(entry) !== 100) await gain(temporary, levelDb(lineLevel(entry)))
          await rename(temporary, clip)
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => {})
          throw error
        }
      }
      delete cleaned[key]
      await saveCleaned(root, read.paths, cleaned, [key])
      return { ok: true }
    } catch (error) {
      return { ok: false, message: lineFailure(key, error) }
    }
  })
}

/**
 * The file of the original kept for a line's clip, or null when the line is not cleaned (no
 * record, or the clip was recorded again since) or the name is not a clip's. For hearing "as
 * recorded" beside what the game has.
 */
export async function originalClipFile(
  projectFile: string,
  partId: string,
  file: string,
  language?: string,
): Promise<string | null> {
  const key = /^([A-Za-z0-9_-]+)\.mp3$/.exec(file)?.[1]
  if (!key) return null
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return null
  const root = dirname(projectFile)
  const cleaned = await cleanedNow(root, read, [])
  if (!isCleaned(cleaned?.[key], read.input.lock[key]) || read.input.manifest[key]?.file !== file) {
    return null
  }
  const kept = resolveInRoot(root, originalFile(read.project, partId, read.language, key))
  return existsSync(kept) ? kept : null
}
