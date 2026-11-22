/** The pages of the web UI an agent can read the state of. */
export type ReadablePage =
  'Setup' | 'Narration' | 'Music and Stingers' | 'Images' | 'Sound effects' | 'Scenes'

/** One thing an agent may read: a GET route of the studio's API. */
export interface Readable {
  page: ReadablePage
  /** The route as the server declares it, with `:name` for the parts that vary. */
  path: string
  /** `state` answers JSON; `file` answers an image or a sound. */
  kind: 'state' | 'file'
  /** What it shows, in a few words. */
  about: string
}

const state = (page: ReadablePage, path: string, about: string): Readable => ({
  page,
  path,
  kind: 'state',
  about,
})
const file = (page: ReadablePage, path: string, about: string): Readable => ({
  page,
  path,
  kind: 'file',
  about,
})

/**
 * Every GET route of the studio's API, by the page it serves. A test holds this to the server's
 * route table, so a new GET route is classified here before it passes.
 */
export const READABLE: readonly Readable[] = [
  state('Setup', '/api/project', 'the project: its summary, characters, parts, acts and problems'),
  state('Setup', '/api/setup', 'what is set up: keys, tools and models in use'),
  state('Setup', '/api/models', 'the models of the narration stages and their retirement'),
  state('Setup', '/api/changes', 'what git shows changed in the game'),
  state('Setup', '/api/jobs/:id', 'a running or finished job, by its id'),
  state('Setup', '/api/spending', 'what the studio has spent'),
  state('Setup', '/api/credit', 'the Fish Audio credit left'),
  state('Setup', '/api/elevenlabs/account', 'the ElevenLabs account'),
  state('Setup', '/api/elevenlabs/voices/freeable', 'ElevenLabs voices that can be freed'),
  state('Narration', '/api/narration/progress', 'how far the narration is, per part'),
  state(
    'Narration',
    '/api/parts/:part',
    'a part: its lines, takes and what is stale; ?language= reads another language',
  ),
  state('Narration', '/api/parts/:part/lines/:key/heard', 'what was last heard of a line'),
  state(
    'Narration',
    '/api/parts/:part/plan',
    'what generating the part would do and cost; ?language=, ?stage=final, ?speaker=, ?weak=1',
  ),
  state('Narration', '/api/parts/:part/jobs/latest', 'the latest generation job of a part'),
  state('Narration', '/api/parts/:part/lines/:key/takes', "a line's takes"),
  state('Narration', '/api/characters/:id/cleaned-lines', "a voice's lines cleaned in the game"),
  state('Narration', '/api/characters/:id/designs', "a character's designed voices"),
  state('Narration', '/api/characters/:id/ruled-out', "a character's ruled-out voices"),
  state('Narration', '/api/characters/:id/voice', "a character's cast voice"),
  state('Narration', '/api/auditions/:id', "a character's audition"),
  state('Narration', '/api/auditions/:id/sitting', "a character's audition sitting"),
  file('Narration', '/api/parts/:part/clips/:file', "a line's clip in the game; ?language="),
  file('Narration', '/api/parts/:part/originals/:file', 'the original of a cleaned line'),
  file('Narration', '/api/parts/:part/lines/:key/takes/:file', 'a take of a line'),
  file('Narration', '/api/cleaned/:file', 'a cleaned copy made for hearing'),
  file('Narration', '/api/takes/:file', 'an audition take'),
  state('Music and Stingers', '/api/music/tracks/:id/takes', "a track's or stinger's takes"),
  state('Music and Stingers', '/api/music/lists/:id/batch', 'the making of a list of tracks'),
  state('Music and Stingers', '/api/music/model-state', 'the music model and its state'),
  state('Music and Stingers', '/api/music/making', 'the music being made now'),
  file('Music and Stingers', '/api/music/tracks/:id/takes/:file', 'a music take'),
  file('Music and Stingers', '/api/music/tracks/:id/current', 'the chosen track'),
  file('Music and Stingers', '/api/music/clips/:file', 'a music clip in the game'),
  state('Images', '/api/images/motion', "the game's motion renderer"),
  state('Images', '/api/images/making', 'the images being made now'),
  state('Images', '/api/images/take-times', 'how long image takes took here'),
  state('Images', '/api/images/model-state', 'the image model and its state'),
  state('Images', '/api/images/bring-all', 'the run that brings every image in'),
  state('Images', '/api/image-acts/:id/batch', 'the making of an act of images'),
  state('Images', '/api/images/:id/takes', "an image's takes"),
  state('Images', '/api/images/:id/patches', "an image's patches"),
  state('Images', '/api/images/:id/fine-tunes', "an image's fine-tunes"),
  state('Images', '/api/images/:id/fine-tunes/base', "an image's fine-tune base"),
  file('Images', '/api/images/:id/takes/:n', 'an image take'),
  file('Images', '/api/images/:id/takes/:n/game', 'an image take as the game shows it'),
  file('Images', '/api/images/:id/current', 'the chosen image'),
  file('Images', '/api/images/:id/patches/:patch/takes/:n', 'a patch take'),
  file('Images', '/api/images/:id/patches/:patch/takes/:n/game', 'a patch take in the game'),
  file('Images', '/api/images/:id/fine-tunes/:n', 'a fine-tune take'),
  state('Sound effects', '/api/effects/making', 'the effects being made now'),
  state('Sound effects', '/api/effects/models', 'the sound effects model'),
  state('Sound effects', '/api/effects/batch', 'the making of the effects list'),
  state('Sound effects', '/api/effects/:id/takes', "a sound effect's takes"),
  file('Sound effects', '/api/effects/:id/takes/:file', 'a sound effect take'),
  file('Sound effects', '/api/effects/:id/current', 'the chosen sound effect'),
  file('Sound effects', '/api/effects/clips/:file', 'a sound effect clip in the game'),
  state('Scenes', '/api/scene-loudness', 'the scenes being measured now'),
]

/**
 * GET routes of the API an agent may not read, each with its reason. None for now: every GET
 * route only reads. A route that spends credit or changes anything goes here, and the test that
 * holds this file to the route table then still passes.
 */
export const NOT_READABLE: readonly { path: string; reason: string }[] = []

const SEGMENT = /^[^/?#%\\\s\p{Cc}]+$/u

/**
 * Whether a path (with an optional query string) is the route a template describes, `:name`
 * standing for one segment: a path that climbs out with `..` or hides a slash or dot is none.
 */
export function fitsTemplate(template: string, path: string): boolean {
  if (!path.startsWith('/api/') || path.includes('#')) return false
  const route = path.split('?')[0]!.split('/').slice(1)
  const parts = template.split('/').slice(1)
  return (
    parts.length === route.length &&
    parts.every((part, i) => {
      const segment = route[i]!
      return part.startsWith(':')
        ? SEGMENT.test(segment) && segment !== '..' && segment !== '.'
        : part === segment
    })
  )
}

/** The readable entry for a path (with an optional query string), or null for anything else. */
export function matchReadable(path: string): Readable | null {
  return READABLE.find((entry) => fitsTemplate(entry.path, path)) ?? null
}
