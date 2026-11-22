import { EFFECTS_AND_SCENES_ACTIONS } from './mcpActionsEffectsScenes'
import { fitsTemplate } from './mcpReadable'

/** The pages of the web UI an agent can act on so far. */
export type ActionPage = 'Sound effects' | 'Scenes'

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
  /** It can spend credit; the body carries the amounts confirmed, as the UI sends them. */
  spends?: true
}

/**
 * Every change an agent may make (§9): each non-GET route of the studio's API for the pages
 * listed. A test holds this to the server's route table, so a new route is classified here
 * before it passes. The agent acts through the same routes as the web UI, so every check stays.
 */
export const ACTIONS: readonly Action[] = [...EFFECTS_AND_SCENES_ACTIONS]

/** The action for a method and path (with an optional query), or null for anything else. */
export function matchAction(method: string, path: string): Action | null {
  return ACTIONS.find((a) => a.method === method && fitsTemplate(a.path, path)) ?? null
}
