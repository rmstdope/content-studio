import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { formatStaged } from './format-staged'

const project = resolve(import.meta.dir, '..')
const messy = 'const a = {b:"c"};\n'
const tidy = "const a = { b: 'c' }\n"
const repos: string[] = []

// Every test runs git many times, which takes seconds on a busy machine.
setDefaultTimeout(60_000)

afterEach(() => {
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true })
})

/** This process's environment without git's own variables, so a temporary repository stays apart. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', BEADS_DIR: '' }
}

/** Runs a command in `cwd` and returns how it went. */
function run(cwd: string, command: string[]) {
  const env = cleanEnv()
  // A stand-in for beads, which writes down what it was asked to do.
  env.PATH = `${join(cwd, 'bin')}:${env.PATH}`
  const done = Bun.spawnSync(command, { cwd, env })
  return {
    code: done.exitCode,
    out: done.stdout.toString(),
    err: done.stderr.toString(),
  }
}

/** Runs git in `cwd`, failing the test when git fails, and returns its output. */
function git(cwd: string, ...args: string[]): string {
  const done = run(cwd, ['git', ...args])
  if (done.code !== 0) throw new Error(`git ${args.join(' ')}: ${done.err}`)
  return done.out
}

/** Writes a file in a temporary repository, making its folders. */
function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

/** A new git repository with this project's prettier settings, committed. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'format-staged-'))
  repos.push(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  copyFileSync(join(project, '.prettierrc.json'), join(root, '.prettierrc.json'))
  write(root, '.prettierignore', 'ignored/\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'start')
  return root
}

const staged = (root: string, path: string) => git(root, 'cat-file', 'blob', `:${path}`)
const working = (root: string, path: string) => readFileSync(join(root, path), 'utf8')

describe('formatStaged', () => {
  // The script reads git's variables, as it must inside a hook; tests must not inherit them.
  const inherited = Object.keys(process.env).filter((key) => key.startsWith('GIT_'))
  for (const key of inherited) delete process.env[key]

  test('formats a staged file in the index and the working tree', async () => {
    const root = repo()
    write(root, 'src/a file.ts', messy)
    git(root, 'add', '.')

    const report = await formatStaged(root)

    expect(report.formatted).toEqual(['src/a file.ts'])
    expect(staged(root, 'src/a file.ts')).toBe(tidy)
    expect(working(root, 'src/a file.ts')).toBe(tidy)
  })

  test('leaves unstaged changes unstaged and untouched', async () => {
    const root = repo()
    write(root, 'a.ts', messy)
    git(root, 'add', 'a.ts')
    write(root, 'a.ts', `${messy}const   later = 1\n`)

    await formatStaged(root)

    expect(staged(root, 'a.ts')).toBe(tidy)
    expect(working(root, 'a.ts')).toBe(`${messy}const   later = 1\n`)
  })

  test('does not bring back a file deleted after it was staged', async () => {
    const root = repo()
    write(root, 'a.ts', messy)
    git(root, 'add', 'a.ts')
    rmSync(join(root, 'a.ts'))

    await formatStaged(root)

    expect(staged(root, 'a.ts')).toBe(tidy)
    expect(() => working(root, 'a.ts')).toThrow()
  })

  test('keeps an executable file executable', async () => {
    const root = repo()
    write(root, 'a.ts', messy)
    chmodSync(join(root, 'a.ts'), 0o755)
    git(root, 'add', 'a.ts')

    await formatStaged(root)

    expect(git(root, 'ls-files', '-s', 'a.ts')).toStartWith('100755 ')
    expect(git(root, 'diff', '--name-only')).toBe('')
  })

  test('leaves ignored files, unknown types, links and deletions alone', async () => {
    const root = repo()
    write(root, 'gone.ts', tidy)
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'gone')
    git(root, 'rm', '-q', 'gone.ts')
    write(root, 'ignored/a.ts', messy)
    write(root, 'worker.py', 'x  =  1\n')
    symlinkSync('worker.py', join(root, 'link.ts'))
    git(root, 'add', '.')

    const report = await formatStaged(root)

    expect(report).toEqual({ formatted: [], unreadable: [] })
    expect(staged(root, 'ignored/a.ts')).toBe(messy)
    expect(staged(root, 'worker.py')).toBe('x  =  1\n')
    expect(staged(root, 'link.ts')).toBe('worker.py')
  })

  test('reports a file prettier cannot parse and formats the rest', async () => {
    const root = repo()
    write(root, 'broken.ts', 'const = (\n')
    write(root, 'fine.ts', messy)
    git(root, 'add', '.')

    const report = await formatStaged(root)

    expect(report.unreadable.map((file) => file.path)).toEqual(['broken.ts'])
    expect(staged(root, 'broken.ts')).toBe('const = (\n')
    expect(staged(root, 'fine.ts')).toBe(tidy)
  })
})

/** A temporary repository that runs this project's own pre-commit hook and formatter. */
function hookedRepo(): string {
  const root = repo()
  mkdirSync(join(root, 'hooks'))
  copyFileSync(join(project, '.beads/hooks/pre-commit'), join(root, 'hooks/pre-commit'))
  chmodSync(join(root, 'hooks/pre-commit'), 0o755)
  cpSync(join(project, 'scripts/format-staged.ts'), join(root, 'scripts/format-staged.ts'))
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'))
  write(root, 'bin/bd', '#!/bin/sh\necho "$@" >> bin/calls\n')
  chmodSync(join(root, 'bin/bd'), 0o755)
  write(root, '.gitignore', 'node_modules\nbin/\nhooks/\nscripts/\n')
  git(root, 'add', '.gitignore')
  git(root, 'commit', '-q', '-m', 'ignore')
  git(root, 'config', 'core.hooksPath', 'hooks')
  return root
}

describe('the pre-commit hook', () => {
  test('commits staged files formatted', () => {
    const root = hookedRepo()
    write(root, 'a.ts', messy)
    git(root, 'add', 'a.ts')

    git(root, 'commit', '-q', '-m', 'a')

    expect(git(root, 'show', 'HEAD:a.ts')).toBe(tidy)
    expect(git(root, 'status', '--porcelain')).toBe('')
    expect(working(root, 'bin/calls')).toContain('hooks run pre-commit')
  })

  test('commits `git commit -a` formatted', () => {
    const root = hookedRepo()
    write(root, 'a.ts', tidy)
    git(root, 'add', 'a.ts')
    git(root, 'commit', '-q', '-m', 'a')
    write(root, 'a.ts', 'const a = {b:"d"};\n')

    git(root, 'commit', '-q', '-a', '-m', 'd')

    expect(git(root, 'show', 'HEAD:a.ts')).toBe("const a = { b: 'd' }\n")
    expect(git(root, 'status', '--porcelain')).toBe('')
  })

  test('asks for `git commit <paths>` again once it has formatted the files', () => {
    const root = hookedRepo()
    write(root, 'a.ts', tidy)
    git(root, 'add', 'a.ts')
    git(root, 'commit', '-q', '-m', 'a')
    write(root, 'a.ts', 'const a = {b:"d"};\n')

    const first = run(root, ['git', 'commit', '-q', '-m', 'd', 'a.ts'])

    expect(first.code).not.toBe(0)
    expect(first.err).toContain('commit again')
    expect(working(root, 'a.ts')).toBe("const a = { b: 'd' }\n")
    git(root, 'commit', '-q', '-m', 'd', 'a.ts')
    expect(git(root, 'status', '--porcelain')).toBe('')
  })
})

describe('bun install', () => {
  test('points core.hooksPath at the repository own hooks', () => {
    const root = repo()
    git(root, 'config', 'core.hooksPath', '/nowhere/.beads/hooks')
    const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      scripts: { prepare: string }
    }

    expect(run(root, ['sh', '-c', manifest.scripts.prepare]).code).toBe(0)

    expect(git(root, 'config', 'core.hooksPath')).toBe('.beads/hooks\n')
  })

  test('does not fail outside a git repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'format-staged-plain-'))
    repos.push(root)
    const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      scripts: { prepare: string }
    }

    expect(run(root, ['sh', '-c', manifest.scripts.prepare]).code).toBe(0)
  })
})
