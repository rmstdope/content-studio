import type { Action } from './mcpActions'

const SET_ASIDE = 'may set aside the patches and named areas chosen for the image'
const DELETES = 'deletes this take from the studio'

const images = (about: string, method: Action['method'], path: string, body?: string): Action => ({
  page: 'Images',
  method,
  path,
  about,
  ...(body ? { body } : {}),
})

const asking = (action: Action, confirm: string): Action => ({ ...action, confirm })

/**
 * The Images steps an agent may do: one entry per change route of the page, and Refresh from the
 * game for an act's images, which is the part route with the act's id (§9).
 */
export const IMAGE_ACTIONS: readonly Action[] = [
  images(
    'Refresh dialog of a part, and refresh an act from the game for its images, music or scenes (runs the project’s refresh.part; pass the act’s id as :part)',
    'POST',
    '/api/parts/:part/refresh',
  ),
  images(
    'save the image style’s look, or what is kept out',
    'PATCH',
    '/api/image-style',
    '{ look } or { keepOut }',
  ),
  images(
    'save the words of an image, or null for the game’s',
    'PATCH',
    '/api/images/:id',
    '{ words: string | null }',
  ),
  images(
    'use the act’s style for an image, or another act’s',
    'PATCH',
    '/api/images/:id/act-style',
    '{ on } or { from }',
  ),
  images(
    'settle an image whose game description changed',
    'POST',
    '/api/images/:id/compare',
    "{ choice: 'keep' | 'game' }",
  ),
  images(
    'save the words of a patch the game declares',
    'PATCH',
    '/api/images/:id/game-patches/:patch',
    '{ words: string | null }',
  ),
  images(
    'settle a game patch whose description changed',
    'POST',
    '/api/images/:id/game-patches/:patch/compare',
    "{ choice: 'keep' | 'game' }",
  ),
  images(
    'place or clear the box of a named area',
    'PUT',
    '/api/images/:id/areas/:area',
    '{ box: {x,y,width,height} | null }',
  ),
  images(
    'set the effects the game plays on an image',
    'PUT',
    '/api/images/:id/effects',
    '{ effects: { [type]: { on, settings } } }',
  ),
  images(
    'set the slow zoom of an image, or null for none',
    'PUT',
    '/api/images/:id/zoom',
    '{ zoom: { on, seconds, percent } | null }',
  ),
  images(
    'make takes of an image, or a failed one again',
    'POST',
    '/api/images/:id/takes',
    '{ count, model? } or { retry }',
  ),
  asking(
    images('drop a take', 'DELETE', '/api/images/:id/takes/:n'),
    `${DELETES} and ${SET_ASIDE}`,
  ),
  images('mark a take as seen', 'POST', '/api/images/:id/takes/:n/seen'),
  asking(
    images('choose a take for the game', 'POST', '/api/images/:id/choose', '{ n }'),
    `chooses this take for the game and ${SET_ASIDE}`,
  ),
  asking(
    images('un-choose the chosen take', 'POST', '/api/images/:id/unchoose'),
    `un-chooses the take the game uses and ${SET_ASIDE}`,
  ),
  images('accept the take the game already has', 'POST', '/api/images/:id/accept'),
  images('stop the image’s takes being made', 'POST', '/api/images/:id/stop'),
  images('copy another image’s picture to this one', 'POST', '/api/images/:id/copy', '{ from }'),
  asking(
    images('make every image of an act', 'POST', '/api/image-acts/:id/make-all'),
    'makes four takes for every image of the act with no chosen take, and the model runs for a while',
  ),
  images('close the finished making of an act', 'POST', '/api/image-acts/:id/batch/close'),
  images('stop making an act’s images', 'POST', '/api/image-acts/:id/stop'),
  images('bring every image in from the game', 'POST', '/api/images/bring-all'),
  images(
    'make takes of every patch of an image',
    'POST',
    '/api/images/:id/patches/remake',
    '{ count, marks, model? }',
  ),
  images('stop making the patches of an image', 'POST', '/api/images/:id/patches/remake/stop'),
  images('close the finished making of patches', 'POST', '/api/images/:id/patches/remake/close'),
  images(
    'make takes of a patch, or a failed one again',
    'POST',
    '/api/images/:id/patches/:patch/takes',
    '{ count, area, model? } or { retry }',
  ),
  asking(
    images('drop a patch’s take', 'DELETE', '/api/images/:id/patches/:patch/takes/:n'),
    `${DELETES} and may set aside the patches lying on top of it`,
  ),
  images('mark a patch’s take as seen', 'POST', '/api/images/:id/patches/:patch/takes/:n/seen'),
  asking(
    images(
      'choose a take of a patch for the game',
      'POST',
      '/api/images/:id/patches/:patch/choose',
      '{ n }',
    ),
    'puts this take of the patch on the image in the game, and may set aside the patches lying on top of it',
  ),
  asking(
    images('un-choose a patch’s take', 'POST', '/api/images/:id/patches/:patch/unchoose'),
    'takes this patch off the image in the game until another take is chosen, may set aside the patches lying on top of it, and the take stays among the takes',
  ),
  images('stop making takes of a patch', 'POST', '/api/images/:id/patches/:patch/stop'),
  images(
    'make fine-tunes of an image, or a failed one again',
    'POST',
    '/api/images/:id/fine-tunes',
    '{ count, words, area, model? } or { retry }',
  ),
  images('stop making fine-tunes', 'POST', '/api/images/:id/fine-tunes/stop'),
  images(
    'use a fine-tune as the image’s next take, chosen',
    'POST',
    '/api/images/:id/fine-tunes/use',
    '{ n }',
  ),
  asking(images('drop a fine-tune', 'DELETE', '/api/images/:id/fine-tunes/:n'), DELETES),
  images('mark a fine-tune as seen', 'POST', '/api/images/:id/fine-tunes/:n/seen'),
]
