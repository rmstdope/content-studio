import { MODEL_BODIES } from '../core/modelBodies'
import { BriefChangeBody } from '../core/music'
import {
  ChooseTakeBody,
  MakeTakesBody,
  MoveTakeBody,
  SetFadesBody,
  TrimTakeBody,
} from '../core/musicTake'
import type { Action } from './mcpActions'

const MUSIC = 'Music and Stingers' as const
const change = (
  method: Action['method'],
  path: string,
  body: Action['body'] | null,
  about: string,
  extra: Pick<Action, 'confirm' | 'spends'> & { page?: Action['page'] } = {},
): Action => ({ page: MUSIC, method, path, body: body ?? undefined, about, ...extra })

/** The Music and Stingers steps an agent may do: one entry per change route of those pages. */
export const MUSIC_ACTIONS: readonly Action[] = [
  change(
    'PATCH',
    '/api/music/tracks/:id',
    BriefChangeBody,
    "saves one field of a track's or stinger's brief (the studio's change over the game's)",
  ),
  change(
    'POST',
    '/api/music/tracks/:id/keep-mine',
    null,
    "keeps the studio's brief over the game's",
  ),
  change(
    'POST',
    '/api/music/tracks/:id/takes',
    MakeTakesBody,
    'makes takes (count 1 to the limit), or tries a failed one again; on the paid ElevenLabs model it spends credit, so it asks first',
    { spends: true },
  ),
  change('POST', '/api/music/tracks/:id/stop', null, 'stops the takes being made'),
  change(
    'POST',
    '/api/music/tracks/:id/choose',
    ChooseTakeBody,
    'chooses a take: it plays in the game',
  ),
  change('POST', '/api/music/tracks/:id/unchoose', null, 'un-chooses the chosen take', {
    confirm: "deletes the track's music file from the game; the take stays on the board",
  }),
  change('POST', '/api/music/tracks/:id/accept', null, 'accepts a changed brief for the track'),
  change('DELETE', '/api/music/tracks/:id/takes/:file', null, 'drops a take from the board', {
    confirm: "deletes this take's music from the studio",
  }),
  change('PUT', '/api/music/tracks/:id/takes/:file/fades', SetFadesBody, "saves a take's fades"),
  change('DELETE', '/api/music/tracks/:id/takes/:file/fades', null, "removes a take's fades"),
  change(
    'POST',
    '/api/music/tracks/:id/trim',
    TrimTakeBody,
    "trims a take's silence, or undoes the trim",
  ),
  change(
    'POST',
    '/api/music/tracks/:id/move',
    MoveTakeBody,
    "moves a take to another track's board",
  ),
  change(
    'POST',
    '/api/music/tracks/:id/remove',
    null,
    "removes a track the game no longer lists, with the game's file and its takes",
    {
      confirm:
        'deletes the music file of a track the game no longer asks for, its takes and any brief changes made in the studio',
    },
  ),
  change(
    'PUT',
    '/api/music/model',
    MODEL_BODIES.music,
    "saves the project's music model (the Music row of Setup's Models panel)",
    { page: 'Setup' },
  ),
  change(
    'POST',
    '/api/music/lists/:id/make-all',
    null,
    "makes takes for a list's tracks; on the paid ElevenLabs model it spends credit, so it asks first",
    { spends: true },
  ),
  change('POST', '/api/music/lists/:id/batch/close', null, "closes a list's finished making"),
  change('POST', '/api/music/lists/:id/stop', null, "stops a list's making"),
  change(
    'POST',
    '/api/music/stingers/refresh',
    null,
    "Refresh from the game on the Stingers page: runs the project's refresh.shared command",
  ),
]
