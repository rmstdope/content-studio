import { writeWav } from '../../src/core/wav'

/** The rate of the sounds the music system tests make and hear, in samples a second. */
export const RATE = 8000

/**
 * A take as a model makes it: `seconds` of mono sound, a tone of `pitch` Hz from `from` to `to`
 * seconds and silence around it.
 */
export function tone(pitch: number, seconds: number, to = seconds, from = 0) {
  const samples = new Int16Array(seconds * RATE)
  for (let i = Math.round(from * RATE); i < to * RATE; i++) {
    samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * pitch * i) / RATE + 0.1))
  }
  const format = { channels: 1, sampleRate: RATE, bitsPerSample: 16 }
  return writeWav({ format, data: new Uint8Array(samples.buffer) })
}

/** The samples of the MP3 at `path`, decoded to one channel, as a player of the game gets them. */
export function decoded(path: string): Int16Array {
  const run = Bun.spawnSync(
    [
      'ffmpeg',
      '-loglevel',
      'error',
      '-i',
      path,
      '-ac',
      '1',
      '-ar',
      String(RATE),
      '-f',
      's16le',
      '-',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return new Int16Array(new Uint8Array(run.stdout).buffer)
}
