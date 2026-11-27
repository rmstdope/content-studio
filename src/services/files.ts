import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { z } from 'zod'
import { resolveInRoot } from '../core/paths'
import { problemsFrom, type Problem } from '../core/project'
import { orderLockEntry } from '../core/resources'

/** What reading a JSON file gave. */
export type JsonRead =
  { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'invalid'; message: string }

/** A JSON file's value; 'missing' if there is no file, 'invalid' with a message if it is not JSON. */
export async function readJson(file: string): Promise<JsonRead> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'missing' }
    // A file that is there but cannot be read (a folder, no permission) is a problem to show.
    return { status: 'invalid', message: `could not be read (${code ?? (error as Error).message})` }
  }
  try {
    return { status: 'ok', value: JSON.parse(text) }
  } catch (error) {
    return { status: 'invalid', message: `not valid JSON: ${(error as Error).message}` }
  }
}

/**
 * A resource at `path` (relative to `root`) parsed with `schema`: 'missing' if there is no file,
 * 'invalid' if it is broken, with what is wrong added to `problems`.
 */
export async function readResource<T extends z.ZodType>(
  root: string,
  path: string,
  schema: T,
  problems: Problem[],
): Promise<z.infer<T> | 'missing' | 'invalid'> {
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return 'missing'
  if (json.status === 'invalid') {
    problems.push({ file: path, path: '', message: json.message })
    return 'invalid'
  }
  const parsed = schema.safeParse(json.value)
  if (!parsed.success) {
    problems.push(...problemsFrom(path, parsed.error))
    return 'invalid'
  }
  return parsed.data
}

/** The names of the files in a folder; empty if the folder does not exist yet. */
export async function listFiles(folder: string): Promise<Set<string>> {
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    return new Set(entries.filter((e) => e.isFile()).map((e) => e.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

/** What a failed write's error code means, in words a user can act on. */
const WRITE_FAILURES: Record<string, string> = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EROFS: 'the disk is read-only',
  ENOSPC: 'the disk is full',
  EDQUOT: 'the disk quota is used up',
}

/**
 * Why a write failed, as a reason a user can act on ("permission denied"), not the system call
 * and temporary file that met it; an error without a known code gives its own message.
 */
export function writeFailure(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code && Object.hasOwn(WRITE_FAILURES, code)) return WRITE_FAILURES[code]!
  return error instanceof Error ? error.message : String(error)
}

/** Whether a write was refused for a reason `writeFailure` names (no permission, a full disk, …). */
export function isWriteFailure(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return Boolean(code && Object.hasOwn(WRITE_FAILURES, code))
}

/**
 * A file the studio could not write, with its path in the project and the reason a user can act
 * on. The one refusal for a failed write: raised by `writeOrRefuse` (and `refuseWrite`), worded by `refusalSentence`.
 */
export class WriteRefused extends Error {
  constructor(
    /** The file's path in the project. */
    readonly file: string,
    /** Why, as `writeFailure` words it ("permission denied"). */
    readonly reason: string,
    cause: unknown,
  ) {
    super(`${file} could not be written`, { cause })
  }
}

/** A `.catch` handler for any file operation on `path` (a rename, a removal): its failure is a `WriteRefused`. */
export function refuseWrite(path: string): (error: unknown) => never {
  return (error) => {
    throw new WriteRefused(path, writeFailure(error), error)
  }
}

/**
 * The one way a service writes a file: `text` (or bytes) to `path` (relative to `root`) through a
 * temporary file and a rename, so a crash never leaves a half-written file. Each write has its own
 * temporary file, so two writes at once cannot mix. Creates the folder if needed. A failed write is
 * a `WriteRefused` naming `path`, never the system's own error: answer it with `refusalAnswer`,
 * `refusalProblems` or `refusalFailed`, or let it go on to a caller that does.
 */
export async function writeOrRefuse(
  root: string,
  path: string,
  text: string | Uint8Array,
): Promise<void> {
  await replaceFile(root, path, text).catch(refuseWrite(path))
}

/** `writeOrRefuse`'s write, with the system's own error; private, so no service can meet it. */
async function replaceFile(root: string, path: string, text: string | Uint8Array): Promise<void> {
  const file = resolveInRoot(root, path)
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text)
    await rename(temporary, file)
  } catch (error) {
    // Report the write's error, not a failure to clean up after it.
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Writes the files in order, each with `write` (`writeOrRefuse`), so that a game file goes into
 * place only together with the rest (a picture with its manifest and lock): when one is refused,
 * those already written are put back as they were, or removed when they were not there, and the
 * answer names the refused file. `files` is what the sentence calls them when they cannot be put
 * back. A file there that cannot be read is refused before it is written,
 * so a put back never removes it. Any other error goes on.
 */
export async function writeTogether(
  root: string,
  writes: readonly (readonly [string, string | Uint8Array])[],
  {
    write = writeOrRefuse,
    files = "the game's files",
  }: {
    write?: (root: string, path: string, text: string | Uint8Array) => Promise<void>
    files?: string
  } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const putBack: (() => Promise<unknown>)[] = []
  try {
    for (const [path, text] of writes) {
      const was = await readFile(resolveInRoot(root, path)).then(
        (bytes) => new Uint8Array(bytes),
        (error: unknown) => {
          if ((error as { code?: unknown }).code === 'ENOENT') return null
          return refuseWrite(path)(error)
        },
      )
      await write(root, path, text)
      putBack.push(() =>
        was ? write(root, path, was) : rm(resolveInRoot(root, path), { force: true }),
      )
    }
  } catch (error) {
    const sentence = refusalSentence(error)
    if (sentence === null) throw error
    console.error('writing the files together failed', error)
    try {
      for (const step of putBack.reverse()) await step()
    } catch (stuck) {
      console.error('putting the files back failed', stuck)
      return { ok: false, message: `${sentence}, and ${files} could not be put back.` }
    }
    return { ok: false, message: `${sentence}.` }
  }
  return { ok: true }
}

/**
 * A `.catch` handler giving a refused write the answer `answer` makes of it, the refusal kept with
 * its stack in the server log under `what`; any other error goes on.
 */
function onRefusal<T>(what: string, answer: (refused: WriteRefused) => T) {
  return (error: unknown): T => {
    if (!(error instanceof WriteRefused)) throw error
    console.error(what, error)
    return answer(error)
  }
}

/**
 * Answers a refused write (`onRefusal`) as a failed result with a message, worded by `say` (given
 * the one sentence, "<file> could not be written").
 */
export function refusalAnswer(what: string, say: (sentence: string) => string) {
  return onRefusal(what, (refused) => ({ ok: false as const, message: say(refused.message) }))
}

/** Answers a refused write (`onRefusal`) as problems: the reason at the file, at `path` in it. */
export function refusalProblems(what: string, path = '') {
  return onRefusal(what, (refused) => ({
    ok: false as const,
    problems: [{ file: refused.file, path, message: refused.reason }] satisfies Problem[],
  }))
}

/** Answers a refused write (`onRefusal`) as a `failed` result: the reason, with the file. */
export function refusalFailed(what: string) {
  return onRefusal(what, (refused) => ({
    ok: false as const,
    kind: 'failed' as const,
    file: refused.file,
    message: refused.reason,
  }))
}

/** The one sentence for a refused write ("<file> could not be written"); null for any other error. */
export function refusalSentence(error: unknown): string | null {
  return error instanceof WriteRefused ? error.message : null
}

/**
 * A JSON object written one entry per line, keys sorted: `{\n "a": {...},\n "b": {...}\n}\n`.
 * Small diffs when entries change, and still valid JSON.
 */
export function formatEntriesPerLine(record: Record<string, unknown>): string {
  const keys = Object.keys(record).sort()
  if (!keys.length) return '{}\n'
  const lines = keys.map((key) => ` ${JSON.stringify(key)}: ${JSON.stringify(record[key])}`)
  return `{\n${lines.join(',\n')}\n}\n`
}

/** A part's narration lock as text: `formatEntriesPerLine`, each entry's fields in one fixed order. */
export function formatLock(lock: Record<string, Record<string, unknown>>): string {
  return formatEntriesPerLine(
    Object.fromEntries(Object.entries(lock).map(([key, entry]) => [key, orderLockEntry(entry)])),
  )
}

/**
 * A per-part file of the tool's cache (what was heard, notes), read and checked against its
 * schema: `empty` when there is no file; `broken` (with `empty`) when there is one that cannot be
 * read or does not fit, so a caller writing the file can refuse to write over it.
 */
export async function readCached<T extends z.ZodType>(
  root: string,
  dir: string,
  partId: string,
  schema: T,
  empty: z.infer<T>,
  fits: (value: z.infer<T>) => boolean = () => true,
): Promise<{ value: z.infer<T>; broken: boolean; path: string }> {
  const path = characterFile(dir, partId)
  const json = await readJson(resolveInRoot(root, path))
  if (json.status === 'missing') return { value: empty, broken: false, path }
  if (json.status !== 'ok') return { value: empty, broken: true, path }
  const parsed = schema.safeParse(json.value)
  if (!parsed.success || !fits(parsed.data)) return { value: empty, broken: true, path }
  return { value: parsed.data, broken: false, path }
}

/**
 * A file of one character's in a folder of the tool's cache: a readable name plus a short hash of
 * the id, so any character id makes a safe file name.
 */
export function characterFile(dir: string, characterId: string): string {
  const readable = characterId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
  const hash = createHash('sha256').update(characterId).digest('hex').slice(0, 8)
  return `${dir}/${readable}-${hash}.json`
}
