import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { readWav, writeWav } from '../core/wav'
import {
  cleanWav,
  createFfmpegEncoder,
  decodeClip,
  ffmpegEncoder,
  FileNotWritten,
  gainClip,
  levelClip,
  measureSound,
} from './audio'
import { quietestStretch } from '../core/cleanup'
import { levelDb } from '../core/level'

const hasFfmpeg = Bun.which('ffmpeg') !== null

describe.skipIf(!hasFfmpeg)('ffmpegEncoder', () => {
  const tone = writeWav({
    format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
    data: new Uint8Array(16000 * 2),
  })

  it('encodes a WAV into an MP3, leaving no temporary file', async () => {
    const root = tempRepo({})
    const file = join(root, 'clips', 'k1.mp3')
    await ffmpegEncoder(tone, file, { bitrate: '64k', channels: 1 })
    const bytes = readFileSync(file)
    expect(bytes.length).toBeGreaterThan(100)
    expect(readdirSync(join(root, 'clips'))).toEqual(['k1.mp3'])
  })

  it('reports ffmpeg’s own error when it stops reading early', async () => {
    const root = tempRepo({})
    const big = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(20_000_000),
    })
    const failing = ffmpegEncoder(big, join(root, 'k3.mp3'), { bitrate: 'zzz', channels: 1 })
    await expect(failing).rejects.toThrow('ffmpeg could not encode')
    await expect(failing).rejects.not.toThrow('EPIPE')
  })

  it('says ffmpeg’s own reason, not that the file could not be written, for a bad option', async () => {
    const root = tempRepo({})
    const failing = ffmpegEncoder(tone, join(root, 'k5.mp3'), { bitrate: 'zzz', channels: 1 })
    await expect(failing).rejects.toThrow('ffmpeg could not encode')
    await expect(failing).rejects.not.toBeInstanceOf(FileNotWritten)
  })

  it.skipIf(process.getuid?.() === 0)(
    'says plainly that the file could not be written into a folder it may not write in',
    async () => {
      const root = tempRepo({})
      const folder = join(root, 'clips')
      mkdirSync(folder)
      chmodSync(folder, 0o555)
      try {
        const failing = ffmpegEncoder(tone, join(folder, 'k6.mp3'), { bitrate: '64k', channels: 1 })
        await expect(failing).rejects.toBeInstanceOf(FileNotWritten)
        await expect(failing).rejects.toThrow(/^The file could not be written\.$/)
      } finally {
        chmodSync(folder, 0o755)
      }
      expect(readdirSync(folder)).toEqual([])
    },
  )

  it('stops an encode that takes too long, keeping no file', async () => {
    const root = tempRepo({})
    const big = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(20_000_000),
    })
    const file = join(root, 'k4.mp3')
    const slow = createFfmpegEncoder({ timeoutMs: 1 })
    await expect(slow(big, file, { bitrate: '64k', channels: 1 })).rejects.toThrow(
      'took longer than',
    )
    expect(existsSync(file)).toBe(false)
  })

  it('fails on audio it cannot read, keeping no file', async () => {
    const root = tempRepo({})
    const file = join(root, 'k2.mp3')
    await expect(
      ffmpegEncoder(new Uint8Array([1, 2, 3]), file, { bitrate: '64k', channels: 1 }),
    ).rejects.toThrow('ffmpeg could not encode')
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(root)).toEqual([])
  })
})

describe.skipIf(!hasFfmpeg)('decodeClip', () => {
  it('says when decoding takes too long', async () => {
    const root = tempRepo({})
    const file = join(root, 'one.mp3')
    const second = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(16000 * 2),
    })
    await ffmpegEncoder(second, file, { bitrate: '64k', channels: 1 })
    await expect(decodeClip(file, { timeoutMs: 1 })).rejects.toThrow('took longer than')
  })

  it('decodes a clip to WAV at its own rate, and measures its length from it', async () => {
    const root = tempRepo({})
    const file = join(root, 'one.mp3')
    const second = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(16000 * 2),
    })
    await ffmpegEncoder(second, file, { bitrate: '64k', channels: 1 })
    // Piped, ffmpeg cannot fill in the sizes in the header (0xFFFFFFFF): the data is read to the end.
    const { wav, seconds } = await decodeClip(file)
    const { format, data } = readWav(wav)
    expect(format).toMatchObject({ channels: 1, sampleRate: 16000 })
    expect(data.length).toBe(Math.round(seconds * 16000) * 2)
    expect(seconds).toBeGreaterThan(0.95)
    expect(seconds).toBeLessThan(1.1)
  })
})

/** Two seconds of a 220 Hz tone at 24 kHz, at `amplitude` (0–1). */
function sine(amplitude: number): Uint8Array {
  const rate = 24000
  const data = new Uint8Array(rate * 2 * 2)
  const view = new DataView(data.buffer)
  for (let i = 0; i < rate * 2; i++) {
    view.setInt16(
      i * 2,
      Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767),
      true,
    )
  }
  return writeWav({ format: { channels: 1, sampleRate: rate, bitsPerSample: 16 }, data })
}

/**
 * Three seconds of speech-like syllables at 24 kHz: a 220 Hz tone in bursts of a quarter second,
 * each fading out, the loud ones near full scale, so a gain above 100% drives the limiter.
 */
function syllables(): Uint8Array {
  const rate = 24000
  const data = new Uint8Array(rate * 3 * 2)
  const view = new DataView(data.buffer)
  for (let i = 0; i < rate * 3; i++) {
    const syllable = Math.floor(i / (rate / 4))
    const within = (i % (rate / 4)) / (rate / 4)
    const amplitude = (syllable % 2 ? 0.25 : 0.9) * (1 - within)
    view.setInt16(
      i * 2,
      Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767),
      true,
    )
  }
  return writeWav({ format: { channels: 1, sampleRate: rate, bitsPerSample: 16 }, data })
}

/** A file's mean volume in dB, as ffmpeg's volumedetect measures it (for clips too short for loudnorm). */
function meanVolumeOf(file: string): number {
  const detect = Bun.spawnSync([
    'ffmpeg',
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ])
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(detect.stderr.toString())![1])
}

/** A file's integrated loudness, as ffmpeg's loudnorm measures it. */
async function lufsOf(file: string): Promise<number> {
  const run = Bun.spawnSync([
    'ffmpeg',
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
    '-f',
    'null',
    '-',
  ])
  const json = run.stderr
    .toString()
    .match(/\{[^{}]*\}/g)!
    .at(-1)!
  return Number(JSON.parse(json).input_i)
}

describe.skipIf(!hasFfmpeg || !Bun.which('ffprobe'))('levelClip', () => {
  // Each runs ffmpeg up to ten times; on a busy machine that takes more than the usual 5 s.
  const SLOW = 60_000

  it(
    'brings a clip to the target loudness, keeping its rate, channels and bit rate',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'quiet.mp3')
      await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1 })
      expect(Math.abs((await lufsOf(file)) + 16)).toBeGreaterThan(3)
      await levelClip(file, -16)
      expect(Math.abs((await lufsOf(file)) + 16)).toBeLessThanOrEqual(0.5)
      const probe = Bun.spawnSync([
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'stream=sample_rate,channels,bit_rate',
        '-of',
        'json',
        file,
      ])
      expect(JSON.parse(probe.stdout.toString()).streams[0]).toMatchObject({
        sample_rate: '24000',
        channels: 1,
        bit_rate: '64000',
      })
    },
    SLOW,
  )

  it(
    'refuses a clip too silent to measure, leaving it as it was',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'silent.mp3')
      const silent = writeWav({
        format: { channels: 1, sampleRate: 24000, bitsPerSample: 16 },
        data: new Uint8Array(24000 * 2),
      })
      await ffmpegEncoder(silent, file, { bitrate: '64k', channels: 1 })
      const before = readFileSync(file)
      await expect(levelClip(file, -16)).rejects.toThrow('too short or silent')
      expect(readFileSync(file)).toEqual(before)
      expect(readdirSync(root)).toEqual(['silent.mp3'])
    },
    SLOW,
  )

  it(
    'says how loud the clip came out',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'quiet.mp3')
      await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1 })
      expect(Math.abs((await levelClip(file, -16)) + 16)).toBeLessThanOrEqual(0.5)
    },
    SLOW,
  )

  it(
    'leaves no clip when the encoder cannot level it',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'clips', 'k1.mp3')
      const silent = writeWav({
        format: { channels: 1, sampleRate: 24000, bitsPerSample: 16 },
        data: new Uint8Array(24000 * 2),
      })
      await expect(
        ffmpegEncoder(silent, file, { bitrate: '64k', channels: 1, lufs: -16 }),
      ).rejects.toThrow('too short or silent')
      expect(readdirSync(join(root, 'clips'))).toEqual([])
    },
    SLOW,
  )

  it(
    'is done by the encoder when the project names a loudness',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'clips', 'k1.mp3')
      await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1, lufs: -16 })
      expect(Math.abs((await lufsOf(file)) + 16)).toBeLessThanOrEqual(0.5)
      expect(readdirSync(join(root, 'clips'))).toEqual(['k1.mp3'])
    },
    SLOW,
  )
})

/**
 * Three seconds at 16 kHz: a voice-like burst (600 Hz and 1.8 kHz) from 0.5 s to 1.5 s, and a 150 Hz
 * rumble with a little noise under all of it, so the pauses before and after are only rumble.
 */
function rumbling(trailing = 1): Uint8Array {
  const rate = 16000
  const data = new Uint8Array(rate * 3 * 2)
  const view = new DataView(data.buffer)
  let seed = 7
  for (let i = 0; i < rate * 3; i++) {
    const t = i / rate
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const noise = (seed / 0x7fffffff - 0.5) * 0.004
    let v = (0.02 * Math.sin(2 * Math.PI * 150 * t) + noise) * (t > 1.5 ? trailing : 1)
    if (t > 0.5 && t < 1.5) {
      v += 0.3 * Math.sin(2 * Math.PI * 600 * t) + 0.15 * Math.sin(2 * Math.PI * 1800 * t)
    }
    view.setInt16(i * 2, Math.round(v * 32767), true)
  }
  return writeWav({ format: { channels: 1, sampleRate: rate, bitsPerSample: 16 }, data })
}

describe.skipIf(!hasFfmpeg)('cleanWav', () => {
  it('lowers the noise in the pauses and keeps the length and the voice', async () => {
    const before = rumbling()
    const after = await cleanWav(before)
    const a = readWav(before)
    const b = readWav(after)
    expect(b.format).toEqual(a.format)
    expect(b.data.length).toBe(a.data.length)
    const floorBefore = quietestStretch(a, 0.4)!.db
    const floorAfter = quietestStretch(b, 0.4)!.db
    expect(floorAfter).toBeLessThan(floorBefore - 10)
    // The voiced stretch is still there, within 3 dB of what it was.
    const loud = (wav: typeof a) => {
      const view = new DataView(wav.data.buffer, wav.data.byteOffset, wav.data.byteLength)
      let sum = 0
      for (let i = 8000 * 1; i < 16000 + 8000; i++) sum += (view.getInt16(i * 2, true) / 32768) ** 2
      return 10 * Math.log10(sum / 16000)
    }
    expect(Math.abs(loud(b) - loud(a))).toBeLessThan(3)
  })

  it('cleans a pause before the quietest stretch too, when that comes last', async () => {
    const before = readWav(rumbling(0.5))
    const after = readWav(await cleanWav(rumbling(0.5)))
    /** The level of the leading pause, 0.05 s to 0.45 s. */
    const lead = (wav: typeof before) =>
      quietestStretch(
        { format: wav.format, data: wav.data.subarray(0.05 * 16000 * 2, 0.45 * 16000 * 2) },
        0.4,
      )!.db
    expect(lead(after)).toBeLessThan(lead(before) - 10)
  })

  it('is what the encoder does first when asked to clean', async () => {
    const root = tempRepo({})
    const options = { bitrate: '64k', channels: 1 }
    await ffmpegEncoder(rumbling(), join(root, 'plain.mp3'), options)
    await ffmpegEncoder(rumbling(), join(root, 'clean.mp3'), { ...options, clean: true })
    const floorOf = async (name: string) =>
      quietestStretch(readWav((await decodeClip(join(root, name))).wav), 0.4)!.db
    expect(await floorOf('clean.mp3')).toBeLessThan((await floorOf('plain.mp3')) - 10)
  })

  it('gives a take too short to learn from back as it was', async () => {
    const short = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(1000),
    })
    expect(await cleanWav(short)).toEqual(short)
  })

  it('says ffmpeg’s reason when it cannot clean', async () => {
    await expect(cleanWav(rumbling(), { timeoutMs: 1 })).rejects.toThrow('took longer than')
  })
})

describe.skipIf(!hasFfmpeg || !Bun.which('ffprobe'))('gainClip', () => {
  const SLOW = 60_000

  it(
    'raises or lowers a clip by the gain, making up what the encode lost (as-stb4)',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'k1.mp3')
      await ffmpegEncoder(sine(0.2), file, { bitrate: '64k', channels: 1 })
      const before = await lufsOf(file)
      await gainClip(file, levelDb(60))
      const lowered = await lufsOf(file)
      // An MP3 encode alone loses about half a dB; each step comes within 0.1 LU of what it asks.
      expect(Math.abs(lowered - (before + levelDb(60)))).toBeLessThanOrEqual(0.1)
      await gainClip(file, -levelDb(60))
      expect(Math.abs((await lufsOf(file)) - before)).toBeLessThanOrEqual(0.1)
      expect(readdirSync(root)).toEqual(['k1.mp3'])
    },
    SLOW,
  )

  it(
    'never turns the gain more than a dB past what it asks when the limiter holds the clip down',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'k1.mp3')
      const plain = join(root, 'plain.mp3')
      await ffmpegEncoder(syllables(), file, { bitrate: '64k', channels: 1 })
      const asked = levelDb(200)
      // The same gain and limiter as one encode at the asked gain plus a dB, the most it may correct.
      const filter = `volume=${(asked + 1).toFixed(2)}dB,alimiter=limit=0.8414:attack=5:release=50:level=false`
      Bun.spawnSync([
        'ffmpeg',
        '-loglevel',
        'error',
        '-y',
        '-i',
        file,
        '-af',
        filter,
        '-b:a',
        '64k',
        plain,
      ])
      const before = await lufsOf(file)
      await gainClip(file, asked)
      const after = await lufsOf(file)
      expect(after).toBeLessThanOrEqual((await lufsOf(plain)) + 0.05)
      // Held down, but still raised.
      expect(after).toBeGreaterThan(before + 1)
    },
    SLOW,
  )

  it(
    'gives a clip too short to measure the gain once',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'short.mp3')
      // A third of a second: shorter than loudnorm's 400 ms block, so it cannot be measured.
      const { format, data } = readWav(sine(0.2))
      await ffmpegEncoder(writeWav({ format, data: data.slice(0, 8000 * 2) }), file, {
        bitrate: '64k',
        channels: 1,
      })
      const before = meanVolumeOf(file)
      await gainClip(file, levelDb(60))
      expect(Math.abs(meanVolumeOf(file) - (before + levelDb(60)))).toBeLessThanOrEqual(1)
      expect(readdirSync(root)).toEqual(['short.mp3'])
    },
    SLOW,
  )

  it(
    'is applied by the encoder after levelling, when it is asked',
    async () => {
      const root = tempRepo({})
      const file = join(root, 'k1.mp3')
      await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1, lufs: -20, gainDb: -6 })
      expect(Math.abs((await lufsOf(file)) + 26)).toBeLessThanOrEqual(1)
      expect(readdirSync(root)).toEqual(['k1.mp3'])
    },
    SLOW,
  )
})

/** A tone as a WAV: `seconds` long at 16 kHz, mono. */
function tone(seconds: number, amplitude = 0.5): Uint8Array {
  const samples = new Int16Array(Math.round(16000 * seconds))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 440 * i) / 16000))
  }
  return writeWav({
    format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
    data: new Uint8Array(samples.buffer),
  })
}

describe.skipIf(!hasFfmpeg)('measureSound', () => {
  it('gives the length and the loudness of a sound, a louder one measuring higher', async () => {
    const quiet = await measureSound(tone(3, 0.05))
    const loud = await measureSound(tone(3, 0.5))
    expect(quiet.seconds).toBeCloseTo(3, 1)
    expect(loud.lufs!).toBeGreaterThan(quiet.lufs! + 10)
    expect(loud.lufs!).toBeLessThan(0)
    expect(loud.wav.length).toBeGreaterThan(1000)
  })

  it('gives no loudness for a silent sound', async () => {
    const silent = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(16000 * 2 * 2),
    })
    expect((await measureSound(silent)).lufs).toBeNull()
  })

  it('says so for bytes that are no sound', async () => {
    await expect(measureSound(new TextEncoder().encode('not audio'))).rejects.toThrow(
      'the file is not audio ffmpeg can read',
    )
  })
})
