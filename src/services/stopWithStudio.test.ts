import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixture = join(import.meta.dir, '../../test/fixtures/studio-with-worker.ts')
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Whether a process with this pid, or for a negative one any of that process group, is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pid written to `file`, or 0 while it holds none yet. */
function pidIn(file: string): number {
  try {
    return Number(readFileSync(file, 'utf8').trim()) || 0
  } catch {
    return 0
  }
}

describe('a local generator stops with the studio', () => {
  for (const kind of ['line', 'image'] as const) {
    for (const [signal, code] of [
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ] as const) {
      const what = kind === 'line' ? 'a music or effects worker' : 'an image take'
      it(`stops ${what} on a ${signal} that comes the moment it starts`, async () => {
        const pidFile = join(mkdtempSync(join(tmpdir(), 'stop-with-studio-')), 'group.pid')
        const studio = Bun.spawn([process.execPath, fixture, kind, pidFile, signal], {
          stdout: 'ignore',
        })
        let group = 0
        try {
          await studio.exited
          group = pidIn(pidFile)
          expect(group).toBeGreaterThan(0)
          // The studio's own handler ran: without one the signal ends it, and no exit code.
          expect(studio.exitCode).toBe(code)
          for (let i = 0; i < 200 && alive(-group); i++) await wait(50)
          expect(alive(-group)).toBe(false)
        } finally {
          studio.kill('SIGKILL')
          if (group > 0 && alive(-group)) process.kill(-group, 'SIGKILL')
        }
      }, 20_000)

      it(`stops ${what}, and what it started, on ${signal}`, async () => {
        const pidFile = join(mkdtempSync(join(tmpdir(), 'stop-with-studio-')), 'child.pid')
        const studio = Bun.spawn([process.execPath, fixture, kind, pidFile], { stdout: 'ignore' })
        let child = 0
        try {
          for (let i = 0; i < 100 && !child; i++) {
            await wait(50)
            child = pidIn(pidFile)
          }
          expect(child).toBeGreaterThan(0)
          expect(alive(child)).toBe(true)
          studio.kill(signal)
          await studio.exited
          for (let i = 0; i < 20 && alive(child); i++) await wait(50)
          expect(alive(child)).toBe(false)
        } finally {
          studio.kill('SIGKILL')
          if (child > 0 && alive(child)) process.kill(child, 'SIGKILL')
        }
      })
    }
  }
})
