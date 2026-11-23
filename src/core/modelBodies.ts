import { DEFAULT_EFFECT_MODEL, EFFECT_MODEL_IDS } from './effectModels'
import { DEFAULT_ELEVEN_MODEL, ELEVEN_MODEL_IDS } from './elevenSpeech'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS } from './imageModels'
import { DEFAULT_MUSIC_MODEL, MUSIC_MODEL_IDS } from './musicModels'
import { pricedModels } from './prices'
import { RETIRED_MODEL } from './retirement'

/** The five model saves: the Music, Images and Sound effects models, and a stage's Fish or ElevenLabs model. */
export type ModelKind = 'music' | 'images' | 'effects' | 'fish' | 'elevenlabs'

/** Each save's ids, the default when the file names none (null: the file always names one), and where `was` is read. */
function facts(kind: ModelKind): { ids: readonly string[]; fallback: string | null; was: string } {
  switch (kind) {
    case 'music':
      return { ids: MUSIC_MODEL_IDS, fallback: DEFAULT_MUSIC_MODEL, was: 'music.model' }
    case 'images':
      return { ids: IMAGE_MODEL_IDS, fallback: DEFAULT_IMAGE_MODEL, was: 'images.model' }
    case 'effects':
      return { ids: EFFECT_MODEL_IDS, fallback: DEFAULT_EFFECT_MODEL, was: 'effects.model' }
    case 'fish':
      return {
        ids: pricedModels().filter((m) => m !== RETIRED_MODEL),
        fallback: null,
        was: 'models.<stage>',
      }
    case 'elevenlabs':
      return { ids: ELEVEN_MODEL_IDS, fallback: DEFAULT_ELEVEN_MODEL, was: 'elevenlabs.<stage>' }
  }
}

/** What a model save's `model` and `was` take, for a refusal and for the body in the registry. */
export function modelAllowed(kind: ModelKind): string {
  const { ids, fallback, was } = facts(kind)
  const named = ids.map((id) => `"${id}"`).join(', ')
  const none = fallback ? ` ("${fallback}" when the project file names none)` : ''
  return `Allowed: model is one of ${named}; was is the model now in force, as GET /api/models shows it (${was})${none}.`
}

/** The body of a model save as the registry describes it: its shape, then what it takes. */
export function modelBody(kind: ModelKind): string {
  return `{ model, was }. ${modelAllowed(kind)}`
}
