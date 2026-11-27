/**
 * SPD-1: anything paid (a recording, an audition, an ElevenLabs take) first says what it can cost,
 * and is held to the limit the person agreed.
 */
import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeWav } from '../../src/core/wav'
import { fish } from '../../src/server/test-support'
import type { FishClient } from '../../src/services/fish'
import { createFakeMusic } from '../../src/services/musicFake'
import { fakeEleven, projectJson } from '../helpers'
import { startStudio } from './studio'

/** A game whose Fish models are paid ones, with one line in Act I. */
const game = (extra: Record<string, unknown> = {}) => ({
  'content-studio.json': projectJson({
    narration: {
      ...(projectJson().narration as object),
      models: { fish: { audition: 's2-pro', draft: 's2-pro' } },
    },
    ...extra,
  }),
  'content-studio/narration/cast.json': {
    speakers: { narrator: { voice: 'v1', phrase: 'Once upon a time.' } },
  },
  'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'Once.' }],
})

/** The studio on a temporary game, and what its page reads (`get`) and asks it to do (`post`). */
function start(...args: Parameters<typeof startStudio>) {
  const studio = startStudio(...args)
  const get = async (path: string) => (await studio.page.get(path)).json()
  const post = async (path: string, body: unknown = {}) => {
    const response = await studio.page.send('POST', path, body)
    return { status: response.status, body: await response.json() }
  }
  return { ...studio, get, post }
}

/** A Fish account with credit to spare, and every text it was asked (and so billed) to speak. */
function fishAccount() {
  const spoken: string[] = []
  const client: FishClient = {
    ...fish,
    tts: (request) => (spoken.push(request.text), fish.tts(request)),
  }
  return { client, spoken }
}

describe('SPD-1: anything paid says its cost first and is held to the limit agreed', () => {
  it('a recording', async () => {
    const account = fishAccount()
    const studio = start(game(), { fish: account.client })
    const cost = async () => (await studio.get('/api/parts/act1/plan')).plan.ceiling as number
    const record = (confirmedCost?: number) =>
      studio.post('/api/parts/act1/lines/a/record', { confirmedCost })

    const agreed = await cost()
    expect(agreed).toBeGreaterThan(0)
    expect((await record()).body).toMatchObject({ reason: 'confirm', ceiling: agreed })

    // The line grows after the person agreed: what they agreed to no longer covers it.
    writeFileSync(
      join(studio.root, 'tts/act1/script.json'),
      JSON.stringify([{ id: 'a', speaker: 'narrator', text: 'Once, and then again.' }]),
    )
    expect((await record(agreed)).body).toMatchObject({ reason: 'confirm' })
    expect(account.spoken).toEqual([])

    const now = await cost()
    expect(now).toBeGreaterThan(agreed)
    expect((await record(now)).body).toMatchObject({ ok: true })
    expect(account.spoken).toHaveLength(1)
    const spent = (await studio.get('/api/spending')).total
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThanOrEqual(now)
  })

  it('an audition', async () => {
    const account = fishAccount()
    const studio = start(game(), { fish: account.client })
    const take = (voice: string) =>
      studio.post('/api/characters/narrator/takes', { voice, board: true })

    const { perTake } = await studio.get('/api/auditions/narrator/sitting')
    expect(perTake).toBeGreaterThan(0)
    expect((await studio.post('/api/auditions/narrator/start')).body).toMatchObject({
      reason: 'confirm',
    })

    // Enough for one take, not for two.
    const started = await studio.post('/api/auditions/narrator/start', {
      spendUpTo: perTake * 1.5,
    })
    expect(started.status).toBe(200)
    expect((await take('w1')).body).toMatchObject({ ok: true })
    expect((await take('w2')).body).toMatchObject({ ok: false, reason: 'waits' })
    expect(account.spoken).toHaveLength(1)
  })

  it('an ElevenLabs take', async () => {
    const wav = writeWav({
      format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
      data: new Uint8Array(2000),
    })
    const eleven = fakeEleven(
      {},
      {
        speak: () => wav,
        account: {
          tier: 'creator',
          charactersUsed: 0,
          characterLimit: 100_000,
          renewsAt: null,
          overage: 0,
          voiceSlots: { used: 1, limit: 10 },
        },
      },
    )
    const studio = start(
      {
        ...game(),
        'content-studio/narration/cast.json': {
          speakers: { narrator: { voice: 'eleven:george' } },
        },
      },
      { elevenlabs: eleven.client },
    )
    const take = (confirmedCredits?: number) =>
      studio.post('/api/parts/act1/lines/a/takes', { confirmedCredits })

    // One take of the line, where a recording's ceiling counts every retake it may need.
    const { credits } = (await studio.get('/api/parts/act1/plan')).plan.eleven
    expect(credits).toBeGreaterThan(1)
    expect((await take()).body).toMatchObject({ reason: 'confirm-credits' })
    expect((await take(credits - 1)).body).toMatchObject({ reason: 'confirm-credits' })
    expect(eleven.spoken).toEqual([])

    expect((await take(credits)).body).toMatchObject({ ok: true })
    expect(eleven.spoken).toHaveLength(1)
  })

  it('an Eleven Music take an agent asks for', async () => {
    const asked: string[] = []
    const fake = createFakeMusic(0)
    const studio = start(
      {
        ...game({
          music: {
            from: { part: 'tts/{part}/music.json' },
            clips: 'audio/music',
            manifest: 'audio/music/manifest.json',
          },
        }),
        'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'warm lute', seconds: 5 }],
      },
      {
        music: {
          ...fake,
          generate: (request, signal) => (
            asked.push(request.model),
            fake.generate(request, signal)
          ),
        },
      },
    )
    const body = { count: 1, model: 'eleven' }
    const make = (confirmed?: true) =>
      studio.agent.act('POST', '/api/music/tracks/hall/takes', body, confirmed)

    const first = await make()
    expect(first.isError).toBe(true)
    expect(first.content[0]!.text).toMatch(/ElevenLabs credit \(\$\d+\.\d\d a minute\)/)
    expect(asked).toEqual([])

    expect((await make(true)).isError).toBeUndefined()
    // Takes are made in the background: wait until none is left to make.
    const giveUp = Date.now() + 5000
    while ((await studio.get('/api/music/tracks/hall/takes')).making.length) {
      if (Date.now() > giveUp) throw new Error('the take was never made')
      await Bun.sleep(5)
    }
    expect(asked).toEqual(['eleven'])
  })
})
