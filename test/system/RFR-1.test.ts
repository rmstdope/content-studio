/**
 * RFR-1: Refresh dialog on a part's page runs the game's own command to rewrite that part's
 * dialog, and the studio then shows what changed. A command that takes too long is stopped, with
 * nothing left running.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** Act I's dialog as the game has it written, and as its source reads now. */
const written = [
  { id: 'a', speaker: 'narrator', text: 'Once.' },
  { id: 'b', speaker: 'narrator', text: 'The end.' },
]
const source = [
  { id: 'a', speaker: 'narrator', text: 'Once upon a time.' },
  { id: 'c', speaker: 'narrator', text: 'And on.' },
]

/**
 * A game whose refresh.part is its own script `extract.sh`, given the part's id: it writes the
 * part's dialog from the game's source of it.
 */
function start(extract: string) {
  const studio = startStudio({
    'content-studio.json': projectJson({ refresh: { part: 'sh extract.sh {part}' } }),
    'extract.sh': extract,
    'source/act1.json': source,
    'source/act2.json': source,
    'tts/act1/script.json': written,
    'tts/act2/script.json': written,
  })
  const read = (path: string) => readFileSync(join(studio.root, path), 'utf8')
  return {
    ...studio,
    dialog: (part: string) => JSON.parse(read(`tts/${part}/script.json`)),
    /** Refresh dialog, as the button on the part's page asks for it. */
    refresh: () => studio.page.send('POST', '/api/parts/act1/refresh'),
    /** The part's lines as its page shows them. */
    async shown() {
      const response = await studio.page.get('/api/parts/act1')
      const { part } = (await response.json()) as {
        part: { lines: { key: string; text: string }[] }
      }
      return part.lines.map(({ key, text }) => ({ key, text }))
    },
  }
}

/** Whether the process `pid` is still there. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Polls until `done`, giving up after five seconds. */
async function until(done: () => boolean): Promise<void> {
  for (const giveUp = performance.now() + 5000; !done();) {
    if (performance.now() > giveUp) throw new Error('waited five seconds in vain')
    await Bun.sleep(5)
  }
}

/** The processes the slow command noted, to be stopped here too should the studio fail to. */
let started: number[] = []
/** Whether the slow command's test has ended, so that nothing it left waiting goes on. */
let over = false
beforeEach(() => {
  over = false
})
afterEach(() => {
  over = true
  jest.useRealTimers()
})
afterAll(() => {
  for (const pid of started.filter(isRunning)) process.kill(pid, 'SIGKILL')
})

describe('RFR-1: Refresh dialog runs the game’s own command and shows what changed', () => {
  it('rewrites that part’s dialog and shows what changed', async () => {
    const studio = start('cp "source/$1.json" "tts/$1/script.json"')
    expect(await studio.shown()).toEqual([
      { key: 'a', text: 'Once.' },
      { key: 'b', text: 'The end.' },
    ])

    const response = await studio.refresh()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      lines: 2,
      diff: { added: ['c'], removed: ['b'], changed: ['a'] },
    })

    expect(studio.dialog('act1')).toEqual(source)
    expect(studio.dialog('act2')).toEqual(written)
    expect(await studio.shown()).toEqual([
      { key: 'a', text: 'Once upon a time.' },
      { key: 'c', text: 'And on.' },
    ])
  })

  it('stops a command that takes too long, with nothing left running', async () => {
    // The script, a helper it starts, and a helper of that one, each noting its process id.
    const studio = start(
      [
        'echo $$ >> pids',
        `sh -c 'sleep 60 & echo $! >> pids; wait' &`,
        'echo $! >> pids',
        'wait',
      ].join('\n'),
    )
    /** The process ids noted so far, each once its line is whole. */
    const noted = () => {
      const file = join(studio.root, 'pids')
      const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : ['']
      return lines.slice(0, -1).map(Number)
    }

    // The studio's limit is minutes long: its clock is wound past it instead of waited for.
    jest.useFakeTimers()
    try {
      let ended = false
      const answered = studio.refresh().finally(() => (ended = true))
      // Fake timers hold the clocks and Bun.sleep but not setImmediate, so this waits turn by
      // turn: the test's timeout bounds it.
      while (noted().length < 3) {
        if (ended || over) throw new Error('the command never got going')
        await new Promise((resolve) => setImmediate(resolve))
      }
      started = noted()
      expect(started.every(isRunning)).toBe(true)

      jest.advanceTimersByTime(60 * 60_000)
      const response = await answered

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        ok: false,
        reason: 'failed',
        message: expect.stringMatching(/took longer than .* and was stopped/),
      })
    } finally {
      jest.useRealTimers()
    }
    // A killed process takes a moment to be reaped.
    await until(() => !started.some(isRunning))
  })
})
