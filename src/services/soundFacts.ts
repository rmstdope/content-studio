import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measureSound } from './audio'
import type { Transcriber } from './transcriber'

/** What can be told of a sound without hearing it. `heard` is the words, or why there are none. */
export interface SoundFacts {
  seconds: number
  /** Integrated loudness; null when the sound is too short or silent to measure. */
  lufs: number | null
  /** Undefined when words were not asked for. */
  heard: string | { off: string } | undefined
}

/** Whether and how Whisper listens: `transcriber` null when it is off. */
export interface WhisperAsk {
  transcriber: Transcriber | null
  model: string
  language?: string
}

/**
 * The length, the loudness and (when `whisper` is given) the words heard in a sound's bytes, for an
 * agent that cannot hear it. Rejects bytes that are no sound; a Whisper that is off or fails is
 * said in `heard`, never thrown. Nothing is written outside the system's temporary folder.
 */
export async function soundFacts(
  bytes: Uint8Array,
  { whisper }: { whisper?: WhisperAsk },
): Promise<SoundFacts> {
  const { wav, seconds, lufs } = await measureSound(bytes)
  if (!whisper) return { seconds, lufs, heard: undefined }
  if (!whisper.transcriber) {
    return { seconds, lufs, heard: { off: 'Whisper is off, so no words were heard.' } }
  }
  const file = join(tmpdir(), `content-studio-heard-${randomUUID()}.wav`)
  try {
    await writeFile(file, wav)
    const segments = await whisper.transcriber.transcribe(whisper.model, file, whisper.language)
    const text = segments
      .flatMap((s) => s.words ?? [])
      .map((w) => w.word.trim())
      .join(' ')
    return { seconds, lufs, heard: text }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { seconds, lufs, heard: { off: `Whisper could not listen: ${why}` } }
  } finally {
    await rm(file, { force: true }).catch(() => {})
  }
}

/** The line of text an agent reads beside a sound. */
export function describeSound({ seconds, lufs, heard }: SoundFacts): string {
  const loudness = lufs === null ? 'too short or silent to measure' : `${lufs.toFixed(1)} LUFS`
  const base = `Duration ${seconds.toFixed(1)} s, loudness ${loudness}.`
  if (heard === undefined) return base
  if (typeof heard === 'object') return `${base} ${heard.off}`
  return heard === '' ? `${base} Whisper heard nothing.` : `${base} Whisper heard: "${heard}"`
}
