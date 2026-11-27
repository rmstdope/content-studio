// SET-2: the person chooses the models for narration (audition, draft, final), music, images and
// sound effects on Setup, and the choice is saved in the project file.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelsView } from '../../src/services/modelsView'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** The game's project file: every kind of content, naming a model for one narration stage only. */
const PROJECT = projectJson({
  narration: {
    from: { part: 'tts/{part}/script.json' },
    clips: 'audio/{part}',
    manifest: 'audio/{part}/manifest.json',
    models: { elevenlabs: { final: 'eleven_flash_v2_5' } },
  },
  music: {
    from: { part: 'tts/{part}/music.json' },
    clips: 'audio/music',
    manifest: 'audio/music/manifest.json',
  },
  images: {
    from: { part: 'tts/{part}/images.json' },
    clips: 'web/images',
    manifest: 'web/images/manifest.json',
  },
  effects: {
    from: { shared: 'tts/effects.json' },
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  },
})

/** The models chosen, each unlike the one in force and unlike its provider's other stages. */
const FISH = { audition: 's2.1-pro', draft: 's2-pro', final: 'drama-3' } as const
const ELEVEN = {
  audition: 'eleven_flash_v2_5',
  draft: 'eleven_multilingual_v2',
  final: 'eleven_v3',
} as const

const STAGES = ['audition', 'draft', 'final'] as const

// One walk over one studio: the second choice is saved beside the first.
describe('SET-2: the models chosen on Setup are saved in the project file', () => {
  const { root, page } = startStudio({
    'content-studio.json': PROJECT,
    'content-studio/narration/cast.json': { speakers: {} },
  })

  /** The project file as the game now has it. */
  const projectFile = () =>
    JSON.parse(readFileSync(join(root, 'content-studio.json'), 'utf8')) as unknown

  /** What Setup's Models panel shows. */
  async function setup() {
    const view = (await (await page.get('/api/models')).json()) as ModelsView
    if (!view.ok) throw new Error(JSON.stringify(view))
    return view
  }

  /** Chooses `model` in a menu of the panel, which shows `was`. */
  async function choose(path: string, model: string, was: string) {
    const saved = await page.send('PUT', path, { model, was })
    expect([path, saved.status, await saved.json()]).toEqual([path, 200, { ok: true }])
  }

  const narration = PROJECT.narration as Record<string, unknown>
  const chosenNarration = { ...narration, models: { fish: FISH, elevenlabs: ELEVEN } }

  it('saves the audition, draft and final models for narration, from either provider', async () => {
    for (const stage of STAGES) {
      await choose(`/api/models/${stage}`, FISH[stage], (await setup()).models[stage])
      await choose(
        `/api/models/elevenlabs/${stage}`,
        ELEVEN[stage],
        (await setup()).elevenlabs[stage],
      )
    }

    expect(projectFile()).toEqual({ ...PROJECT, narration: chosenNarration })
    expect(await setup()).toMatchObject({ models: FISH, elevenlabs: ELEVEN })
  })

  it('saves the models for music, images and sound effects', async () => {
    const shown = await setup()
    await choose('/api/music/model', 'quick', shown.music!.model)
    await choose('/api/image-model', 'z-image-turbo', shown.images!.model)
    await choose('/api/effect-model', 'open-1', shown.effects!.model)

    expect(projectFile()).toEqual({
      ...PROJECT,
      narration: chosenNarration,
      music: { ...(PROJECT.music as object), model: 'quick' },
      images: { ...(PROJECT.images as object), model: 'z-image-turbo' },
      effects: { ...(PROJECT.effects as object), model: 'open-1' },
    })
    expect(await setup()).toMatchObject({
      music: { model: 'quick' },
      images: { model: 'z-image-turbo' },
      effects: { model: 'open-1' },
    })
  })
})
