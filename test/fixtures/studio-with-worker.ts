// A stand-in for the studio with one local generator running: it starts a worker the way the
// studio does (a line worker, or an image take) whose command leaves a child of its own running,
// as `uv run` leaves python, and waits to be stopped. Given a signal as a third argument, it sends
// itself that signal the moment the worker's process is started, writing that process's pid (which
// leads its group) to the file instead. Used by stopWithStudio.test.ts.
import { writeFileSync } from 'node:fs'
import { createLineWorker } from '../../src/services/lineWorker'
import { createMfluxGenerator } from '../../src/services/images'

const [kind, pidFile, atOnce] = process.argv.slice(2)
const childFile = atOnce ? '/dev/null' : pidFile
const command = ['sh', '-c', `sleep 60 & echo $! > '${childFile}'; wait`]

if (atOnce) {
  const spawn = Bun.spawn
  Bun.spawn = ((...args: Parameters<typeof spawn>) => {
    const proc = spawn(...args)
    writeFileSync(pidFile!, String(proc.pid))
    process.kill(process.pid, atOnce as NodeJS.Signals)
    return proc
  }) as typeof spawn
}

if (kind === 'line') {
  const worker = createLineWorker({
    name: 'The fake',
    command,
    timeoutMs: 60_000,
    couldNotStart: (why) => why,
  })
  worker.request({}).catch(() => {})
} else {
  createMfluxGenerator({ build: (c) => ({ command, out: c.out }), log: () => {} })
    .generate({ prompt: 'a room', width: 1024, height: 576, seed: 42, model: 'klein' })
    .catch(() => {})
}
setInterval(() => {}, 1000)
