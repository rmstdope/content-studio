import { FADES_BODY_TEXT } from '../core/fades'
import type { Action } from './mcpActions'

const MUSIC = 'Music and Stingers' as const
const change = (
  method: Action['method'],
  path: string,
  body: string,
  about: string,
  extra: Pick<Action, 'confirm' | 'spends'> & { page?: Action['page'] } = {},
): Action => ({ page: MUSIC, method, path, body: body || undefined, about, ...extra })

/** The Music and Stingers steps an agent may do: one entry per change route of those pages. */
export const MUSIC_ACTIONS: readonly Action[] = [
  change(
    'PATCH',
    '/api/music/tracks/:id',
    'one of { brief }, { seconds }, { bpm } or { key }',
    "saves one field of a track's or stinger's brief (the studio's change over the game's)",
  ),
  change('POST', '/api/music/tracks/:id/keep-mine', '', "keeps the studio's brief over the game's"),
  change(
    'POST',
    '/api/music/tracks/:id/takes',
    '{ count, model? } or { retry }',
    'makes takes (count 1 to the limit), or tries a failed one again; on the paid ElevenLabs model it spends credit, so it asks first',
    { spends: 'takes' },
  ),
  change('POST', '/api/music/tracks/:id/stop', '', 'stops the takes being made'),
  change(
    'POST',
    '/api/music/tracks/:id/choose',
    '{ file }',
    'chooses a take: it plays in the game',
  ),
  change('POST', '/api/music/tracks/:id/unchoose', '', 'un-chooses the chosen take', {
    confirm: "deletes the track's music file from the game; the take stays on the board",
  }),
  change('POST', '/api/music/tracks/:id/accept', '', 'accepts a changed brief for the track'),
  change('DELETE', '/api/music/tracks/:id/takes/:file', '', 'drops a take from the board'),
  change('PUT', '/api/music/tracks/:id/takes/:file/fades', FADES_BODY_TEXT, "saves a take's fades"),
  change('DELETE', '/api/music/tracks/:id/takes/:file/fades', '', "removes a take's fades"),
  change(
    'POST',
    '/api/music/tracks/:id/trim',
    '{ file, undo? }',
    "trims a take's silence, or undoes the trim",
  ),
  change(
    'POST',
    '/api/music/tracks/:id/move',
    '{ file, to }',
    "moves a take to another track's board",
  ),
  change(
    'POST',
    '/api/music/tracks/:id/remove',
    '',
    "removes a track the game no longer lists, with the game's file and its takes",
    {
      confirm:
        'deletes the music file of a track the game no longer asks for, its takes and any brief changes made in the studio',
    },
  ),
  change(
    'PUT',
    '/api/music/model',
    '{ model, was }',
    "saves the project's music model (the Music row of Setup's Models panel)",
    { page: 'Setup' },
  ),
  change(
    'POST',
    '/api/music/lists/:id/make-all',
    '',
    "makes takes for a list's tracks; on the paid ElevenLabs model it spends credit, so it asks first",
    { spends: 'make-all' },
  ),
  change('POST', '/api/music/lists/:id/batch/close', '', "closes a list's finished making"),
  change('POST', '/api/music/lists/:id/stop', '', "stops a list's making"),
  change(
    'POST',
    '/api/music/stingers/refresh',
    '',
    "Refresh from the game on the Stingers page: runs the project's refresh.shared command",
  ),
]
