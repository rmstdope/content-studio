import { measureSound } from './audio'
import { transcribeWav } from './narration'
import type { Transcriber } from './transcriber'

/** What can be told of a sound without hearing it. `heard` is the words, or why there are none. */
export interface SoundFacts {
  seconds: number
  /** Integrated loudness; null when the sound is too short or silent to measure. */
  lufs: number | null
  /** Undefined when words were not asked for. */
  heard: string | { off: string } | undefined
}

/** How Whisper listens, or `off` with the reason it does not. */
export type WhisperAsk =
  { off: string } | { transcriber: Transcriber; model: string; language?: string }

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
  if ('off' in whisper) return { seconds, lufs, heard: { off: whisper.off } }
  try {
    const segments = await transcribeWav(whisper.transcriber, whisper.model, wav, whisper.language)
    const text = segments
      .flatMap((s) => s.words ?? [])
      .map((w) => w.word.trim())
      .join(' ')
    return { seconds, lufs, heard: text }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { seconds, lufs, heard: { off: `Whisper could not listen: ${why}` } }
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

/**
 * The language Whisper is told for a clip fetched with `?language=asked`: as the studio's own
 * check does, only in a project with several languages, and the one asked if the project has it,
 * else its source language (the first).
 */
export function whisperLanguage(
  languages: readonly string[],
  asked: string | null,
): string | undefined {
  if (languages.length < 2) return undefined
  return languages.find((l) => l === asked) ?? languages[0]
}
