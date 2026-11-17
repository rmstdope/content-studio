import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { resolveInRoot } from '../core/paths'
import type { MotionRendererAnswer } from '../core/motion'
import { openProject } from './projectFile'

/** A path as the project's own, relative to its root with forward slashes. */
function inProject(root: string, path: string): string {
  const from = relative(root, isAbsolute(path) ? path : resolve(root, path))
  return from.split(sep).join('/')
}

/**
 * The project's motion renderer (`images.motion`) bundled for the browser, in memory: the named
 * module and what it imports, all of it inside the project root. Read only, built afresh on every
 * call so an edit shows on the next ask. A renderer that cannot be built is an answer with its file
 * and message (`<file>: <message> (line N)`), never a throw.
 */
export async function readMotionRenderer(projectFile: string): Promise<MotionRendererAnswer> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return { named: false }
  const named = opened.project.images?.motion
  if (named === undefined) return { named: false }
  const root = realpathSync(dirname(projectFile))
  const failed = (file: string, message: string): MotionRendererAnswer => ({
    named: true,
    ok: false,
    file,
    message: `${file}: ${message}`,
  })
  let entry: string
  try {
    entry = resolveInRoot(root, named)
  } catch {
    return failed(named, 'the path is outside the project')
  }
  if (!(await Bun.file(entry).exists())) return failed(named, 'the file is not there')
  try {
    const built = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      metafile: true,
    })
    for (const input of Object.keys(built.metafile?.inputs ?? {})) {
      // The metafile names its inputs from the working directory.
      if (relative(root, resolve(input)).startsWith('..')) {
        return failed(named, `imports ${input}, which is outside the project`)
      }
    }
    const output = built.outputs[0]
    if (!built.success || !output) return failed(named, 'nothing was built')
    return { named: true, ok: true, code: await output.text() }
  } catch (error) {
    const logs = error instanceof AggregateError ? error.errors : [error]
    const first = logs[0] as
      { message?: string; position?: { file?: string; line?: number } | null } | undefined
    const message = first?.message ?? String(error)
    const where = first?.position
    const file = where?.file ? inProject(root, where.file) : named
    const line = where?.line ? ` (line ${where.line})` : ''
    return failed(file, `${message}${line}`)
  }
}
