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
  /** The JSON body in a few words; the route checks it. */
  body?: string
  /** Set where the web UI asks the person to confirm: what is being confirmed. */
  confirm?: string
  /**
   * Set where the step can spend ElevenLabs credit on the paid music model, which the web UI shows
   * as a price on its button: `takes` runs on the model the body, a failed take or the project names,
   * `make-all` on the project's. Such a step needs the confirmation too.
   */
  spends?: 'takes' | 'make-all'
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

/** The action for a method and path (with an optional query), or null for anything else. */
export function matchAction(method: string, path: string): Action | null {
  return ACTIONS.find((a) => a.method === method && fitsTemplate(a.path, path)) ?? null
}
