import { describe, expect, it } from 'bun:test'
import { writeWav } from '../core/wav'
import { describeSound, soundFacts } from './soundFacts'
import type { Transcriber } from './transcriber'

const hasFfmpeg = Bun.which('ffmpeg') !== null

describe('describeSound', () => {
  it('gives the length and the loudness', () => {
    expect(describeSound({ seconds: 3.24, lufs: -19.43, heard: undefined })).toBe(
      'Duration 3.2 s, loudness -19.4 LUFS.',
    )
  })
  it('says a loudness that cannot be measured', () => {
    expect(describeSound({ seconds: 0.2, lufs: null, heard: undefined })).toBe(
      'Duration 0.2 s, loudness too short or silent to measure.',
    )
  })
  it('gives the words heard, or why there are none', () => {
    expect(describeSound({ seconds: 1, lufs: -20, heard: 'Once upon a time.' })).toBe(
      'Duration 1.0 s, loudness -20.0 LUFS. Whisper heard: "Once upon a time."',
    )
    expect(describeSound({ seconds: 1, lufs: -20, heard: '' })).toBe(
      'Duration 1.0 s, loudness -20.0 LUFS. Whisper heard nothing.',
    )
    expect(describeSound({ seconds: 1, lufs: -20, heard: { off: 'Whisper is off.' } })).toBe(
      'Duration 1.0 s, loudness -20.0 LUFS. Whisper is off.',
    )
  })
})

describe.skipIf(!hasFfmpeg)('soundFacts', () => {
  const wav = writeWav({
    format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
    data: new Uint8Array(16000 * 2),
  })
  const heard = (text: string): Transcriber => ({
    transcribe: async () => [
      {
        start: 0,
        end: 1,
        words: text.split(' ').map((word, i) => ({ word: ` ${word}`, start: i, end: i + 1 })),
      },
    ],
    close() {},
  })

  it('has no words unless asked', async () => {
    const facts = await soundFacts(wav, {})
    expect(facts.seconds).toBeCloseTo(1, 1)
    expect(facts.heard).toBeUndefined()
  })

  it('gives the words Whisper heard, in the language asked', async () => {
    let language: string | undefined
    const transcriber: Transcriber = {
      transcribe: async (_m, _p, l) => {
        language = l
        return heard('Once upon').transcribe('m', 'p')
      },
      close() {},
    }
    const facts = await soundFacts(wav, { whisper: { transcriber, model: 'm', language: 'sv' } })
    expect(facts.heard).toBe('Once upon')
    expect(language).toBe('sv')
  })

  it('says why there are no words when Whisper is off or fails', async () => {
    expect((await soundFacts(wav, { whisper: { transcriber: null, model: 'm' } })).heard).toEqual({
      off: 'Whisper is off, so no words were heard.',
    })
    const broken: Transcriber = {
      transcribe: async () => {
        throw new Error('no uv')
      },
      close() {},
    }
    expect((await soundFacts(wav, { whisper: { transcriber: broken, model: 'm' } })).heard).toEqual(
      { off: 'Whisper could not listen: no uv' },
    )
  })

  it('refuses what is no sound', async () => {
    await expect(soundFacts(new TextEncoder().encode('no'), {})).rejects.toThrow()
  })
})
