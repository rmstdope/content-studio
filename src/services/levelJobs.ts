import { cleanedLinesOf } from './cleanLines'
import { levelLine, type LevelDeps } from './levelLines'

/** A job that sets a voice's lines in the game to a level, as the page shows it. */
export interface LevelJobState {
  /** The level the lines are being set to, in percent. */
  level: number
  /** Lines the job set out to do. */
  total: number
  /** Lines finished: done, or failed. */
  done: number
  /** The lines that failed, with the reason as given. */
  failed: { part: string; key: string; message: string }[]
  status: 'running' | 'done'
}

/** What starting a job says when the voice already has one going. */
export const LEVEL_BUSY = 'This voice is being set to a level already.'

/** The level jobs of a server, one voice and language at a time. */
export interface LevelJobs {
  /** Starts a job over the lines not at `level`; null when every line is, or the voice has none. */
  start(
    projectFile: string,
    speaker: string,
    language: string | undefined,
    level: number,
    deps?: LevelDeps,
  ): Promise<LevelJobState | { error: string } | null>
  /** The latest job of the voice in the language, running or not. */
  get(speaker: string, language: string | undefined): LevelJobState | null
  /** Whether the voice has a job going. */
  running(speaker: string, language: string | undefined): boolean
  /** Resolves when the voice's job has ended (for tests, and for ending the server). */
  settled(speaker: string, language: string | undefined): Promise<void>
}

const keyOf = (speaker: string, language: string | undefined) => `${speaker}\n${language ?? ''}`

/**
 * Jobs that set a voice's lines in the game to its level (§8.4). Lines go one at a time (ffmpeg is
 * the cost), a failed line is noted and the rest go on, and there is no stop, so a voice is never
 * left half-way by choice. The state stays in memory after the job ends, so a page that was left
 * shows where it got to; which lines are at which level is read from the lock, so nothing is lost
 * when the server restarts.
 */
export function createLevelJobs(): LevelJobs {
  const states = new Map<string, LevelJobState>()
  const ending = new Map<string, Promise<void>>()
  const starting = new Set<string>()
  const running = (key: string) => states.get(key)?.status === 'running' || starting.has(key)

  return {
    async start(projectFile, speaker, language, level, deps) {
      const key = keyOf(speaker, language)
      if (running(key)) return { error: LEVEL_BUSY }
      starting.add(key)
      let todo
      try {
        const found = await cleanedLinesOf(projectFile, speaker, language)
        todo = found.lines.filter((l) => l.level !== level)
        if (!todo.length) {
          states.delete(key)
          return null
        }
        const state: LevelJobState = {
          level,
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
              const result = await levelLine(
                projectFile,
                line.part,
                language,
                line.key,
                level,
                deps,
              )
              state.done++
              if (!result.ok)
                state.failed.push({ part: line.part, key: line.key, message: result.message })
            }
            state.status = 'done'
          })(),
        )
        return { ...state, failed: [] }
      } finally {
        starting.delete(key)
      }
    },
    get: (speaker, language) => {
      const state = states.get(keyOf(speaker, language))
      return state ? { ...state, failed: [...state.failed] } : null
    },
    running: (speaker, language) => running(keyOf(speaker, language)),
    settled: async (speaker, language) => {
      await ending.get(keyOf(speaker, language))
    },
  }
}
