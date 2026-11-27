import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const script = join(import.meta.dir, 'ci-ffmpeg.sh')

/** Writes a shell script standing in for one of the build's files. */
function program(file: string, body: string): void {
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
}

describe('scripts/ci-ffmpeg.sh', () => {
  let root: string
  let url: string
  let sha256: string
  let dir: string
  let githubPath: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ci-ffmpeg-'))
    // Shaped like the real build: one top folder holding bin/ and lib/.
    const build = join(root, 'pack', 'ffmpeg-build')
    mkdirSync(join(build, 'bin'), { recursive: true })
    mkdirSync(join(build, 'lib'))
    for (const name of ['ffmpeg', 'ffprobe', 'ffplay']) {
      program(join(build, 'bin', name), `echo "${name} version 1"; echo "built with"`)
    }
    writeFileSync(join(build, 'lib', 'libavutil.so.1'), 'a library')
    const archive = join(root, 'ffmpeg.tar.xz')
    const tar = Bun.spawnSync(['tar', '-cJf', archive, '-C', join(root, 'pack'), 'ffmpeg-build'])
    if (tar.exitCode !== 0) throw new Error(tar.stderr.toString())
    url = pathToFileURL(archive).href
    sha256 = new Bun.CryptoHasher('sha256').update(readFileSync(archive)).digest('hex')
  })

  beforeEach(() => {
    const run = mkdtempSync(join(root, 'run-'))
    dir = join(run, 'ffmpeg')
    githubPath = join(run, 'github-path')
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  /** Runs the script on `dir` as a CI step would, with the pin replaced. */
  function install(pin: { url?: string; sha256?: string } = {}) {
    const result = Bun.spawnSync(['bash', script, dir], {
      env: {
        ...process.env,
        FFMPEG_URL: pin.url ?? url,
        FFMPEG_SHA256: pin.sha256 ?? sha256,
        GITHUB_PATH: githubPath,
      },
    })
    return { code: result.exitCode, out: result.stdout.toString() }
  }

  it('installs ffmpeg, ffprobe and their libraries, and puts them on the path', () => {
    const { code, out } = install()

    expect(code).toBe(0)
    expect(out).toContain('ffmpeg version 1\n')
    expect(out).toContain('ffprobe version 1\n')
    expect(out).not.toContain('built with')
    expect(existsSync(join(dir, 'lib', 'libavutil.so.1'))).toBe(true)
    expect(existsSync(join(dir, 'bin', 'ffplay'))).toBe(false)
    expect(readFileSync(githubPath, 'utf8')).toBe(`${join(dir, 'bin')}\n`)
  })

  it('refuses an archive whose checksum differs, installing nothing', () => {
    const { code } = install({ sha256: '0'.repeat(64) })

    expect(code).not.toBe(0)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(githubPath)).toBe(false)
  })

  it('uses a restored install without downloading', () => {
    expect(install().code).toBe(0)
    rmSync(githubPath)

    const { code, out } = install({ url: pathToFileURL(join(root, 'gone.tar.xz')).href })

    expect(code).toBe(0)
    expect(out).toContain('ffmpeg version 1\n')
    expect(readFileSync(githubPath, 'utf8')).toBe(`${join(dir, 'bin')}\n`)
  })

  it('fails when a restored binary does not run', () => {
    expect(install().code).toBe(0)
    rmSync(githubPath)
    program(join(dir, 'bin', 'ffprobe'), 'exit 127')

    expect(install().code).not.toBe(0)
    expect(existsSync(githubPath)).toBe(false)
  })
})
