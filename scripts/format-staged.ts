/**
 * Formats the files staged for a commit with prettier, for the pre-commit hook
 * (`.beads/hooks/pre-commit`), so `format:check` never fails on a change just committed.
 */
import { lstatSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { format, getFileInfo, resolveConfig } from 'prettier'

/** What formatting the staged files did. */
export type FormatStagedReport = {
  /** The files whose staged content was changed. */
  formatted: string[]
  /** The files prettier could not format, left as they were staged. */
  unreadable: { path: string; reason: string }[]
}

/** Runs git in `root`, with `input` on its standard input, and returns its output. */
function git(root: string, args: string[], input?: string): string {
  const done = Bun.spawnSync(['git', ...args], {
    cwd: root,
    env: process.env,
    stdin: input === undefined ? 'ignore' : Buffer.from(input),
  })
  if (done.exitCode !== 0) throw new Error(`git ${args[0]}: ${done.stderr.toString()}`)
  return done.stdout.toString()
}

/** The files this commit adds or changes, without links and submodules. */
function stagedFiles(root: string): { path: string; mode: string; blob: string }[] {
  const fields = git(root, [
    'diff',
    '--cached',
    '--raw',
    '-z',
    '--no-abbrev',
    '--no-renames',
    '--diff-filter=AMT',
  ]).split('\0')
  const files = []
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [, mode = '', , blob = ''] = fields[i]!.split(' ')
    if (mode === '100644' || mode === '100755') files.push({ path: fields[i + 1]!, mode, blob })
  }
  return files
}

/** Whether the working file still holds exactly what was staged. */
function unchangedSinceStaged(root: string, path: string, blob: string): boolean {
  const stat = lstatSync(join(root, path), { throwIfNoEntry: false })
  if (!stat?.isFile()) return false
  return git(root, ['hash-object', '--', path]).trim() === blob
}

/**
 * Formats what is staged in the repository at `root`, not what lies in the working tree, so
 * unstaged changes are never committed. A working file with no unstaged changes is rewritten
 * to match; one with them is left alone.
 */
export async function formatStaged(root: string): Promise<FormatStagedReport> {
  const report: FormatStagedReport = { formatted: [], unreadable: [] }
  const ignorePath = [join(root, '.gitignore'), join(root, '.prettierignore')]
  for (const { path, mode, blob } of stagedFiles(root)) {
    const filepath = join(root, path)
    const info = await getFileInfo(filepath, { ignorePath, resolveConfig: true })
    if (info.ignored || info.inferredParser === null) continue
    const source = git(root, ['cat-file', 'blob', blob])
    let result: string
    try {
      const options = await resolveConfig(filepath, { editorconfig: true })
      result = await format(source, { ...options, filepath })
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0]! : String(error)
      report.unreadable.push({ path, reason })
      continue
    }
    if (result === source) continue
    const rewrite = unchangedSinceStaged(root, path, blob)
    const formatted = git(root, ['hash-object', '-w', '--stdin'], result).trim()
    git(root, ['update-index', '--cacheinfo', `${mode},${formatted},${path}`])
    if (rewrite) writeFileSync(filepath, result)
    report.formatted.push(path)
  }
  return report
}

if (import.meta.main) {
  const { formatted, unreadable } = await formatStaged(process.cwd())
  for (const { path, reason } of unreadable)
    console.error(`pre-commit: ${path} not formatted: ${reason}`)
  // `git commit <paths>` commits from a temporary index and has already written the real one, which
  // a hook cannot change: committing now would leave the unformatted files staged afterwards.
  const partial = basename(process.env.GIT_INDEX_FILE ?? '').startsWith('next-index-')
  if (partial && formatted.length > 0) {
    console.error(`pre-commit: formatted ${formatted.join(', ')}; commit again.`)
    process.exit(1)
  }
}
