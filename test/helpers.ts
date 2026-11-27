import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Voice } from '../src/core/voiceSearch'
import type { ElevenAccount } from '../src/core/setup'
import type { ElevenLabsClient, SpeechRequest } from '../src/services/elevenlabs'
import { WriteRefused } from '../src/services/files'

/** A minimal valid project file; override any top-level key. */
export function projectJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    name: 'Test Game',
    partLabel: 'Act',
    parts: [
      { id: 'act1', title: 'Act I' },
      { id: 'act2', title: 'Act II' },
    ],
    narration: {
      from: { part: 'tts/{part}/script.json' },
      clips: 'audio/{part}',
      manifest: 'audio/{part}/manifest.json',
    },
    ...overrides,
  }
}

/** The narration section of a project in several languages, with `{language}` in every path. */
export function narrationInLanguages(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    from: { part: 'tts/{part}/{language}/script.json' },
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
    ...extra,
  }
}

/** A temporary consumer repository holding `files` (path → JSON value, or raw text; undefined leaves it out). */
export function tempRepo(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'content-studio-test-'))
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return root
}

/** The entries the take engine keeps in `slot` for the takes of the project at `projectFile`. */
function takeEntries(slot: string, projectFile: string): { state: string }[] {
  type Slots = Record<string, Map<string, Map<number, { state: string }>> | undefined>
  const engine = (globalThis as unknown as Slots)[slot]
  // A renamed slot would read as no takes at all, and every wait on it would pass at once.
  if (!engine) throw new Error(`no take engine keeps its entries in ${slot}`)
  return [...engine]
    .filter(([key]) => key.startsWith(`${projectFile}\0`))
    .flatMap(([, entries]) => [...entries.values()])
}

/**
 * Whether the take engine of `slot` still has a take of the project waiting or being made. One that
 * is on the board already shows as made in a view while its job is not yet over.
 */
export function takesUnderWay(slot: string, projectFile: string): boolean {
  return takeEntries(slot, projectFile).some((entry) => entry.state !== 'failed')
}

/**
 * Waits until a take of the project shows failed in the engine of `slot`: for a test that has
 * broken the board, so that no view can be read meanwhile.
 */
export async function takeFailed(slot: string, projectFile: string): Promise<void> {
  const failed = () => takeEntries(slot, projectFile).some((entry) => entry.state === 'failed')
  for (const giveUp = Date.now() + 10_000; !failed();) {
    if (Date.now() > giveUp) throw new Error('the take never failed')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/**
 * An ElevenLabs client that knows `voices` (by ElevenLabs' own id), speaks with `speak` and has
 * `account`, when given; anything else it is asked rejects. `asked` lists the voices looked up,
 * `spoken` the speech asked for.
 */
export function fakeEleven(
  voices: Record<string, Voice> = {},
  {
    speak,
    account,
  }: { speak?: () => Uint8Array | Promise<Uint8Array>; account?: ElevenAccount } = {},
): { client: ElevenLabsClient; asked: string[]; spoken: SpeechRequest[] } {
  const asked: string[] = []
  const spoken: SpeechRequest[] = []
  const unused = () => Promise.reject(new Error('not used'))
  const client: ElevenLabsClient = {
    subscription: account ? async () => account : unused,
    music: unused,
    tts: speak ? async (request) => (spoken.push(request), await speak()) : unused,
    sharedVoices: unused,
    addSharedVoice: unused,
    deleteVoice: unused,
    designVoices: unused,
    saveDesignedVoice: unused,
    async voice(id) {
      asked.push(id)
      const found = voices[id]
      if (!found)
        throw new Error('ElevenLabs answered 404: A voice with the voice_id was not found.')
      return found
    },
  }
  return { client, asked, spoken }
}

/** An ElevenLabs voice as the client gives it: George, with a preview. */
export function elevenVoiceOf(id: string, title = 'George'): Voice {
  return {
    id: `eleven:${id}`,
    title,
    description: 'Warm storyteller',
    tags: ['british'],
    languages: ['en'],
    uses: 0,
    likes: 0,
    author: '',
    sample: { text: '', audio: `https://example.com/${id}.mp3` },
  }
}

/**
 * The sentence a refused write of `file` answers with, as `WriteRefused` words it, for a refused
 * case to compare with: the wording itself is pinned in src/services/files.test.ts alone.
 */
export function refusedSentence(file: string, reason = 'permission denied'): string {
  return new WriteRefused(file, reason, null).message
}

/**
 * `refusedSentence` as the source of a regular expression, for a file that only a pattern can name
 * (a take's random name): `file` matches where the sentence names it.
 */
export function refusedPattern(file: RegExp, reason = 'permission denied'): string {
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return refusedSentence('\0', reason).split('\0').map(literal).join(file.source)
}

/** Whether a read-only folder refuses writes: it does not for root, so those tests are skipped. */
export const canRefuseWrites = process.getuid?.() !== 0

/**
 * Runs `run` with `folder` read-only, so every write into it is refused, and with the server log's
 * errors collected instead of printed; gives what `run` answered and what was logged.
 */
export async function refusingWrites<T>(
  folder: string,
  run: () => Promise<T>,
): Promise<{ answer: T; logged: unknown[][] }> {
  const logged: unknown[][] = []
  const quiet = console.error
  console.error = (...args: unknown[]) => void logged.push(args)
  chmodSync(folder, 0o555)
  try {
    return { answer: await run(), logged }
  } finally {
    chmodSync(folder, 0o755)
    console.error = quiet
  }
}
