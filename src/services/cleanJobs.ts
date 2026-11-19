import { CLEANING_BUSY } from '../core/cleanedLines'
import { cleanLine, cleanedLinesOf, putBackLine, voiceCleaned, type CleanDeps } from './cleanLines'

/** What a job does to each line: cleans it, or puts its original back. */
export type CleanJobKind = 'clean' | 'putback'

/** A clean-up or put-back job as the page shows it. */
export interface CleanJobState {
  kind: CleanJobKind
  /** Lines the job set out to do. */
  total: number
  /** Lines finished: done, or failed. */
  done: number
  /** The lines that failed, with the reason as given. */
  failed: { part: string; key: string; message: string }[]
  /** `stopping` is a Stop asked for, honoured once the line in hand is done. */
  status: 'running' | 'stopping' | 'done' | 'stopped'
}

/** The clean-up jobs of a server, one voice and language at a time. */
export interface CleanJobs {
  /** Starts a job over the lines it applies to, or says why not. */
  start(
    projectFile: string,
    speaker: string,
    language: string | undefined,
    kind: CleanJobKind,
    deps?: CleanDeps,
  ): Promise<CleanJobState | { error: string }>
  /** The latest job of the voice in the language, running or not. */
  get(speaker: string, language: string | undefined): CleanJobState | null
  /** Asks a running clean-up to stop after the line in hand; a put back cannot be stopped. */
  stop(speaker: string, language: string | undefined): CleanJobState | null
  /** Resolves when the voice's job has ended (for tests, and for ending the server). */
  settled(speaker: string, language: string | undefined): Promise<void>
}

const keyOf = (speaker: string, language: string | undefined) => `${speaker}\n${language ?? ''}`

/**
 * Jobs that clean a voice's lines in the game, or put them back (§8.4). Lines go one at a time
 * (ffmpeg is the cost), a failed line is noted and the rest go on, and the state stays in memory
 * after the job ends, so a page that was left shows where it got to. What is cleaned is counted
 * from the files, so nothing is lost when the server restarts.
 */
export function createCleanJobs(): CleanJobs {
  const states = new Map<string, CleanJobState>()
  const ending = new Map<string, Promise<void>>()
  /** Voices whose job is being set up: two starts at once must not both go on. */
  const starting = new Set<string>()

  return {
    async start(projectFile, speaker, language, kind, deps) {
      const key = keyOf(speaker, language)
      const running = states.get(key)
      if (
        starting.has(key) ||
        (running && (running.status === 'running' || running.status === 'stopping'))
      ) {
        return { error: CLEANING_BUSY }
      }
      starting.add(key)
      let lines
      try {
        if (kind === 'clean' && !(await voiceCleaned(projectFile, speaker, language))) {
          return { error: 'The clean-up is switched off for this voice.' }
        }
        const found = await cleanedLinesOf(projectFile, speaker, language)
        if (found.problem) return { error: found.problem }
        lines = found.lines
      } finally {
        starting.delete(key)
      }
      const todo = lines.filter((l) => l.cleaned === (kind === 'putback'))
      if (!todo.length) {
        return {
          error:
            kind === 'clean' ? 'There are no lines to clean.' : 'There are no lines to put back.',
        }
      }
      const state: CleanJobState = {
        kind,
        total: todo.length,
        done: 0,
        failed: [],
        status: 'running',
      }
      states.set(key, state)
      ending.set(
        key,
        (async () => {
          for (const line of todo) {
            if (state.status === 'stopping') break
            // Switched off meanwhile: the rest are left as recorded.
            if (kind === 'clean' && !(await voiceCleaned(projectFile, speaker, language))) {
              state.status = 'stopping'
              break
            }
            const result =
              kind === 'clean'
                ? await cleanLine(projectFile, line.part, language, line.key, deps)
                : await putBackLine(projectFile, line.part, language, line.key)
            state.done++
            if (!result.ok)
              state.failed.push({ part: line.part, key: line.key, message: result.message })
          }
          state.status = state.status === 'stopping' ? 'stopped' : 'done'
        })(),
      )
      return { ...state }
    },
    get: (speaker, language) => {
      const state = states.get(keyOf(speaker, language))
      return state ? { ...state, failed: [...state.failed] } : null
    },
    stop(speaker, language) {
      const state = states.get(keyOf(speaker, language))
      if (state?.kind === 'clean' && state.status === 'running') state.status = 'stopping'
      return state ? { ...state } : null
    },
    settled: async (speaker, language) => {
      await ending.get(keyOf(speaker, language))
    },
  }
}
