import { z } from 'zod'
import { bodyAllowed } from './bodyText'
import { DEFAULT_EFFECT_MODEL, EFFECT_MODEL_IDS } from './effectModels'
import { DEFAULT_ELEVEN_MODEL, ELEVEN_MODEL_IDS } from './elevenSpeech'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS } from './imageModels'
import { DEFAULT_MUSIC_MODEL, MUSIC_MODEL_IDS } from './musicModels'
import { FREE_MODELS } from './project'
import { pricedModels } from './prices'
import { RETIRED_MODEL } from './retirement'

/** The five model saves: the Music, Images and Sound effects models, and a stage's Fish or ElevenLabs model. */
export type ModelKind = 'music' | 'images' | 'effects' | 'fish' | 'elevenlabs'

/** Each save's ids, the default when the file names none, and where `was` is read. */
function facts(kind: ModelKind): { ids: readonly string[]; fallback: string; was: string } {
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
        fallback: FREE_MODELS[0],
        was: 'models.<stage>',
      }
    case 'elevenlabs':
      return { ids: ELEVEN_MODEL_IDS, fallback: DEFAULT_ELEVEN_MODEL, was: 'elevenlabs.<stage>' }
  }
}

/** The body of a model save: the model chosen and the one shown, saying which ids it takes. */
function modelSave(kind: ModelKind) {
  const { ids, fallback, was } = facts(kind)
  const named = ids.map((id) => `"${id}"`).join(', ')
  return z
    .object({
      // Any text here: an id the studio does not know is refused by the save, with a 409.
      model: z
        .string()
        .min(1)
        .meta({ description: `one of ${named}` }),
      was: z
        .string()
        .min(1)
        .meta({
          description: `the model now in force, as GET /api/models shows it (${was}), "${fallback}" when the project file names none`,
        }),
    })
    .strict()
}

/** Each model save's body: what the page chose for a stage or a medium, and what it showed. */
export const MODEL_BODIES = {
  music: modelSave('music'),
  images: modelSave('images'),
  effects: modelSave('effects'),
  fish: modelSave('fish'),
  elevenlabs: modelSave('elevenlabs'),
} satisfies Record<ModelKind, z.ZodType>

/** What a model save takes, in words, for the save's refusal of an id the studio does not know. */
export function modelAllowed(kind: ModelKind): string {
  return bodyAllowed(MODEL_BODIES[kind])
}
