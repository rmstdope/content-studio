import type { ZodType } from 'zod'
import { bodyText } from '../core/bodyText'
import { EFFECTS_AND_SCENES_ACTIONS } from './mcpActionsEffectsScenes'
import { IMAGE_ACTIONS } from './mcpActionsImages'
import { MUSIC_ACTIONS } from './mcpActionsMusic'
import { SETUP_AND_NARRATION_ACTIONS } from './mcpActionsNarration'
import { fitsTemplate } from './mcpReadable'

/** The pages of the web UI an agent can act on so far. */
export type ActionPage =
  'Images' | 'Music and Stingers' | 'Narration' | 'Scenes' | 'Setup' | 'Sound effects'

/** One thing an agent may do: a change the studio's own routes take. */
export interface Action {
  page: ActionPage
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** The route as the server declares it, with `:name` for the parts that vary. */
  path: string
  /** What it does, in a few words. */
  about: string
  /**
   * The body: the very schema the route checks it with, so what an agent is told is what the route
   * takes; or, for the route that takes a form, the words for it.
   */
  body?: ZodType | { form: string }
  /**
   * What the person is asked to confirm before the step: set where the web UI asks, and on every
   * step that removes a clip or a take, which a test holds the registry to (`mcpActions.test.ts`).
   */
  confirm?: string | ConditionalConfirm
  /**
   * Set where the step can spend ElevenLabs credit on the paid music model, which the web UI shows
   * as a price on its button. The route says what a call would cost at `<path>/cost` (a
   * `SpendCheck`, or the refusal the step would give), which `studio_act` asks before it asks the
   * person; it holds none of the route's conditions itself.
   */
  spends?: true
}

/** A confirmation a step needs only for some bodies. */
export interface ConditionalConfirm {
  /** When it is asked and for what, as `studio_pages` shows it. */
  when: string
  /** What this body needs confirmed; null for one that goes ahead without asking. */
  line: (body: unknown) => string | null
}

/** What a call of a step with this body needs the user to confirm; null for nothing. */
export function confirmLine({ confirm }: Action, body: unknown): string | null {
  if (typeof confirm === 'object') return confirm.line(body)
  return confirm ?? null
}

/**
 * Every change an agent may make (§9): each non-GET route of the studio's API for the pages
 * listed. A test holds this to the server's route table, so a new route is classified here
 * before it passes. The agent acts through the same routes as the web UI, so every check stays.
 */
export const ACTIONS: readonly Action[] = [
  ...SETUP_AND_NARRATION_ACTIONS,
  ...IMAGE_ACTIONS,
  ...EFFECTS_AND_SCENES_ACTIONS,
  ...MUSIC_ACTIONS,
]

/** An action's body in words, as `studio_pages` shows it; undefined for a step without one. */
export function actionBody({ body }: Action): string | undefined {
  if (!body) return undefined
  return 'form' in body ? `form: ${body.form}` : bodyText(body)
}

/** The action for a method and path (with an optional query), or null for anything else. */
export function matchAction(method: string, path: string): Action | null {
  return ACTIONS.find((a) => a.method === method && fitsTemplate(a.path, path)) ?? null
}
