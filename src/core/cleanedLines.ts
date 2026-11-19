import { z } from 'zod'
import { NARRATION_DIR, type Project } from './project'

/**
 * A part's record of the lines cleaned in the game (`content-studio/narration/<part>[.<lang>].cleaned.json`):
 * line key → when the clip was made (the lock entry's `at`) and the file of the original kept.
 */
export const CleanedSchema = z.record(
  z.string(),
  z.object({ at: z.string(), original: z.string() }),
)

/** A part's record of cleaned lines. */
export type Cleaned = z.infer<typeof CleanedSchema>

/** What was recorded of one cleaned line. */
export type CleanedEntry = Cleaned[string]

/**
 * Whether a line's clip is cleaned: there is a record, and the clip is still the one that was
 * cleaned. A line recorded again has a new lock time, so its old record stops counting.
 */
export function isCleaned(
  entry: CleanedEntry | undefined,
  lock: { at: string } | undefined,
): boolean {
  return Boolean(entry && lock && entry.at === lock.at)
}

/** Where a part's originals are kept in `language`: beside its other narration files in the studio folder. */
export function originalsDir(
  project: Pick<Project, 'languages'>,
  partId: string,
  language: string,
): string {
  const suffix = language === project.languages[0] ? '' : `.${language}`
  return `${NARRATION_DIR}/originals/${partId}${suffix}`
}

/** The kept original of a line's clip. */
export function originalFile(
  project: Pick<Project, 'languages'>,
  partId: string,
  language: string,
  key: string,
): string {
  return `${originalsDir(project, partId, language)}/${key}.mp3`
}

/** What starting a job says when the voice already has one running; the page waits on it. */
export const CLEANING_BUSY = 'This voice is being cleaned already.'
