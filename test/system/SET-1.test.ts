// SET-1: Setup shows every tool, key and model each kind of content needs, whether it is there, and
// how to install what is missing.
import { describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SetupCheck } from '../../src/core/setup'
import { createFakeEffects } from '../../src/services/effectsFake'
import { mfluxReady } from '../../src/services/images'
import { createFakeImages } from '../../src/services/imagesFake'
import type { SetupResult } from '../../src/services/setup'
import { projectJson, tempRepo } from '../helpers'
import { startStudio } from './studio'

/** A game with every kind of content, and a command that extracts its dialog. */
const PROJECT = projectJson({
  refresh: { part: 'bun extract.ts {part}' },
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

/** Whether the person has installed the tools yet, and downloaded the models. */
const installed = { tools: false, models: false }

/** Where this computer's music models are looked for. */
const modelFolders = tempRepo({})
const aceStep = join(modelFolders, 'ace-step')
const stableAudio = join(modelFolders, 'stable-audio')

/** An Apple-silicon Mac with no key in its environment. */
const machine = { which: () => installed.tools, platform: 'darwin', arch: 'arm64' }
const download = () => (installed.models ? ('whole' as const) : ('absent' as const))

/** The command that downloads a repository from Hugging Face. */
const hf = (repo: string) => `uvx --from huggingface_hub hf download ${repo}`

/** The commands a row's numbered steps give to copy. */
const commands = (row: SetupCheck) => row.steps?.list.flatMap((step) => step.commands ?? []) ?? []

// One walk over one studio: the person installs what Setup says is missing, and checks again.
describe('SET-1: Setup shows what is missing, how to install it, and what is there', () => {
  const { root, page } = startStudio(
    {
      'content-studio.json': PROJECT,
      'tts/effects.json': [{ id: 'coins', text: 'Coins', seconds: 1 }],
    },
    {
      computer: {
        machine,
        environment: { ACESTEP_CHECKPOINTS: aceStep },
        stableAudioDir: stableAudio,
      },
      images: { ...createFakeImages(0), ready: () => mfluxReady(machine), download },
      effects: { ...createFakeEffects(0), download },
    },
  )

  /** What Setup shows, as the page asks for it on opening and on Check again: each row by its id. */
  async function setup() {
    const result = (await (await page.get('/api/setup')).json()) as SetupResult
    if (!result.ok) throw new Error(JSON.stringify(result))
    return {
      states: Object.fromEntries(result.checks.map((check) => [check.id, check.state])),
      row: (id: SetupCheck['id']) => result.checks.find((check) => check.id === id)!,
    }
  }

  it('names every missing tool and key, with how to install it', async () => {
    const { states, row } = await setup()

    expect(states).toEqual({
      ffmpeg: 'problem',
      whisper: 'problem',
      key: 'problem',
      fish: 'off',
      requests: 'off',
      refresh: 'ok',
      music: 'problem',
      stableAudio: 'off',
      imageModels: 'problem',
      effectModels: 'problem',
      elevenlabsKey: 'off',
      elevenlabs: 'off',
    })
    expect(row('ffmpeg').fix).toContain('brew install ffmpeg')
    // uv runs Whisper, the music models and the sound-effect models: each of those rows says so.
    expect(row('whisper').fix).toContain('brew install uv')
    expect(row('music').fix).toContain('brew install uv')
    expect(commands(row('effectModels'))).toEqual(['brew install uv'])
    expect(commands(row('imageModels'))[0]).toBe('uv tool install --upgrade mflux')
    expect(row('key').fix).toContain('Put FISH_AUDIO_API_KEY=... in .env')
    expect(row('elevenlabsKey').fix).toContain('Put ELEVENLABS_API_KEY=... in .env')
  })

  it('shows the tools and keys put in place, and how to download every missing model', async () => {
    installed.tools = true
    writeFileSync(join(root, '.env'), 'FISH_AUDIO_API_KEY=f\nELEVENLABS_API_KEY=e\n')

    const { states, row } = await setup()

    expect(states).toEqual({
      ffmpeg: 'ok',
      whisper: 'ok',
      key: 'ok',
      fish: 'ok',
      requests: 'ok',
      refresh: 'ok',
      music: 'problem',
      stableAudio: 'off',
      imageModels: 'problem',
      effectModels: 'problem',
      elevenlabsKey: 'ok',
      elevenlabs: 'ok',
    })
    // The Whisper model is the one thing that installs itself.
    expect(row('whisper').detail).toContain('is downloaded on the first take')
    expect(row('music').detail).toContain(
      'acestep-v15-xl-turbo, acestep-5Hz-lm-4B are missing from',
    )
    expect(row('music').fix).toContain(
      `Put the models acestep-v15-xl-turbo and acestep-5Hz-lm-4B (about 28 GB) in ${aceStep}`,
    )
    for (const model of ['stable-audio-open-1.0', 'stable-audio-open-small']) {
      expect(commands(row('stableAudio'))).toContain(
        `HF_TOKEN=… ${hf(`stabilityai/${model}`)} --local-dir ~/.cache/stable-audio/${model}`,
      )
    }
    // The three image models, and the one that only makes patches.
    expect(commands(row('imageModels'))).toEqual([
      hf('black-forest-labs/FLUX.2-klein-4B'),
      hf('Tongyi-MAI/Z-Image-Turbo'),
      hf('Qwen/Qwen-Image'),
      hf('Qwen/Qwen-Image-Edit-2511'),
    ])
    expect(commands(row('effectModels'))).toEqual([
      `HF_TOKEN=… ${hf('stabilityai/stable-audio-3-small-sfx')}`,
      `HF_TOKEN=… ${hf('stabilityai/stable-audio-open-1.0')} --local-dir ~/.cache/stable-audio/stable-audio-open-1.0`,
    ])
  })

  it('shows everything there once the models are downloaded', async () => {
    installed.models = true
    for (const folder of ['acestep-v15-xl-turbo', 'acestep-5Hz-lm-4B']) {
      mkdirSync(join(aceStep, folder), { recursive: true })
    }
    for (const folder of ['stable-audio-open-1.0', 'stable-audio-open-small']) {
      mkdirSync(join(stableAudio, folder), { recursive: true })
    }

    const { states, row } = await setup()

    expect(Object.entries(states).filter(([, state]) => state !== 'ok')).toEqual([])
    expect(Object.keys(states)).toHaveLength(12)
    expect(commands(row('imageModels'))).toEqual([])
  })
})
