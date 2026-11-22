import type { Action } from './mcpActions'

/** The Sound effects and Scenes steps an agent may do: one entry per change route of those pages. */
export const EFFECTS_AND_SCENES_ACTIONS: readonly Action[] = [
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/refresh',
    about: "refresh the effects list from the game (runs the project's refresh.shared)",
  },
  {
    page: 'Sound effects',
    method: 'PATCH',
    path: '/api/effects/:id',
    about: "set an effect's description, or null to clear it",
    body: '{ description: string | null }',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/keep-mine',
    about: "keep your description of an effect the game's list changed",
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/forget',
    about: 'forget your description of an effect the game no longer lists',
    confirm:
      'deletes your words for this effect; the game no longer lists it, so there is nothing else to lose',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/takes',
    about: 'make takes for an effect',
    body: '{ count } or { retry }',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/unchoose',
    about: 'un-choose the chosen take',
    confirm:
      "un-chooses the effect's chosen take, so the game has no sound for it until another is chosen",
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/accept',
    about: "accept the chosen take for the effect's changed description, as it is",
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/stop',
    about: 'stop making takes for an effect',
  },
  {
    page: 'Sound effects',
    method: 'DELETE',
    path: '/api/effects/:id/takes/:file',
    about: 'drop a take',
    confirm: "deletes this take's sound from the studio",
  },
  {
    page: 'Sound effects',
    method: 'PUT',
    path: '/api/effects/:id/takes/:file/fades',
    about: "set a take's fades",
    body: '{ in, out, shape }',
  },
  {
    page: 'Sound effects',
    method: 'DELETE',
    path: '/api/effects/:id/takes/:file/fades',
    about: "take a take's fades away",
  },
  {
    page: 'Sound effects',
    method: 'PUT',
    path: '/api/effects/:id/takes/:file/level',
    about: "set a take's level",
    body: '{ level }',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/choose',
    about: 'choose a take for the game',
    body: '{ file }',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/:id/trim',
    about: 'trim a take, or undo the trim',
    body: '{ file, undo? }',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/make-all',
    about: 'make four takes for each of these effects',
    body: '{ ids }',
    confirm:
      'makes four takes for each of the effects listed in ids, and the model runs for a while',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/batch/close',
    about: 'close the finished Make all report',
  },
  {
    page: 'Sound effects',
    method: 'POST',
    path: '/api/effects/stop-all',
    about: 'stop the Make all in progress',
  },
  {
    page: 'Scenes',
    method: 'POST',
    path: '/api/scene-loudness/:part',
    about: "measure the loudness of a part's scenes",
    body: '{ open?: { scene, entry } }',
  },
  {
    page: 'Scenes',
    method: 'PUT',
    path: '/api/scenes/:part/:id',
    about: "save a scene's mix",
    body: '{ scene, was, moved? }',
  },
]
