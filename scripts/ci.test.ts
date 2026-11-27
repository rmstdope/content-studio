import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = join(import.meta.dir, '..')
const read = (path: string) => readFileSync(join(repo, path), 'utf8')
const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts

interface Workflow {
  on: Record<string, { branches?: string[] } | null>
  jobs: Record<string, { needs?: unknown; if?: unknown; steps: { run?: string }[] }>
}
const workflow = Bun.YAML.parse(read('.github/workflows/ci.yml')) as Workflow
/** The job that runs `command` as one of its steps. */
const jobRunning = (command: string) =>
  Object.values(workflow.jobs).find((job) => job.steps.some((step) => step.run === command))

describe('the tests', () => {
  it('run side by side in worker processes, all of them', () => {
    // Nothing after --parallel: no file pattern and no shard that would leave some out.
    expect(scripts.test).toBe('bun test --parallel')
    expect(scripts.check).toEndWith('&& bun run test')
  })

  it('run in CI through that script, on every pull request and on main', () => {
    expect(workflow.on).toEqual({ push: { branches: ['main'] }, pull_request: null })
    const tests = jobRunning('bun run test')
    expect(tests).toBeDefined()
    expect(tests!.if).toBeUndefined()
  })

  it('do not wait for the format and type checks', () => {
    const tests = jobRunning('bun run test')
    const format = jobRunning('bun run format:check')
    expect(tests).toBeDefined()
    expect(format).toBeDefined()
    expect(jobRunning('bun run typecheck')).toBe(format)
    expect(format).not.toBe(tests)
    expect(tests?.needs).toBeUndefined()
    expect(format!.if).toBeUndefined()
  })
})
