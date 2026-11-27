// SPD-2: the Spending page shows what has been spent, dollars and credits apart.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SpendingAnswer } from '../../src/core/spending'
import { createFakeMusic } from '../../src/services/musicFake'
import { fakeEleven, projectJson } from '../helpers'
import { jobEnded, startStudio, wavOf } from './studio'

/** What the narrator (a Fish voice) and the guide (an ElevenLabs one) say: ASCII, a byte a letter. */
const NARRATOR = 'The door opened onto a long, dark hall. '.repeat(10).trim()
const GUIDE = 'Follow me, and mind the step on the way down.'

// One walk over one studio: each test goes on from what the ones before it spent.
describe('SPD-2: the Spending page shows what has been spent, dollars and credits apart', () => {
  const eleven = fakeEleven(
    {},
    {
      speak: () => wavOf(1),
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
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson({
        narration: {
          ...(projectJson().narration as object),
          models: { fish: { audition: 's2-pro', draft: 's2-pro' } },
        },
        music: {
          from: { part: 'tts/{part}/music.json' },
          clips: 'audio/music',
          manifest: 'audio/music/manifest.json',
        },
      }),
      'content-studio/narration/cast.json': {
        speakers: {
          narrator: { voice: 'v1' },
          guide: { voice: 'eleven:george' },
        },
      },
      'tts/act1/script.json': [
        { id: 'a', speaker: 'narrator', text: NARRATOR },
        { id: 'g', speaker: 'guide', text: GUIDE },
      ],
      // Played for 40 seconds, a loop is made 20 longer: a minute, which is what is billed.
      'tts/act1/music.json': [{ id: 'hall', title: 'Hall', text: 'Warm lute', seconds: 40 }],
    },
    { elevenlabs: eleven.client, music: createFakeMusic(0) },
  )

  // The prices: Fish's s2-pro is $15 a million bytes, ElevenLabs' v3 a credit a character, and
  // Eleven Music $0.15 a minute.
  const recordingDollars = (NARRATOR.length * 15) / 1_000_000
  const musicDollars = 0.15

  /** The characters of the character take, which are its credits: set by the take's test. */
  let said = 0

  /** What the page is told. */
  async function spending() {
    const answer = (await (await page.get('/api/spending')).json()) as SpendingAnswer
    if (!answer.ok) throw new Error(JSON.stringify(answer.problems))
    return answer
  }

  async function post(path: string, body: unknown) {
    const response = await page.send('POST', path, body)
    expect(response.status).toBe(200)
    return (await response.json()) as Record<string, unknown>
  }

  it('shows nothing spent before anything is', async () => {
    expect(await spending()).toMatchObject({ total: 0, credits: 0, rows: [] })
  })

  it('shows a recording’s dollars and its credits, each on its own', async () => {
    const shown = await page.get('/api/parts/act1/plan')
    const { plan } = (await shown.json()) as {
      plan: { keys: string[]; ceiling: number; eleven: { ceiling: number } }
    }
    const { id } = await post('/api/parts/act1/jobs', {
      speaker: null,
      keys: plan.keys,
      orphans: [],
      confirmedCost: plan.ceiling,
      confirmedCredits: plan.eleven.ceiling,
    })
    expect(await jobEnded(page, id as string)).toMatchObject({ status: 'done', failed: [] })

    const { total, credits, rows, acts } = await spending()
    expect(total).toBeCloseTo(recordingDollars, 10)
    expect(credits).toBe(GUIDE.length)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ part: 'act1', lines: 2, credits: GUIDE.length })
    expect(rows[0]!.cost).toBeCloseTo(recordingDollars, 10)
    expect(acts[0]).toMatchObject({ part: 'act1', credits: GUIDE.length })
    expect(acts[0]!.total).toBeCloseTo(recordingDollars, 10)
  })

  it('adds a take of an ElevenLabs voice to the credits alone', async () => {
    const before = await spending()
    expect(await post('/api/characters/guide/takes', { voice: 'eleven:george' })).toMatchObject({
      ok: true,
    })

    const after = await spending()
    // What the take said is the studio's to pick: its credits are the characters ElevenLabs got.
    said = eleven.spoken.at(-1)!.text.length
    expect(after.credits).toBe(GUIDE.length + said)
    expect(after.tries).toEqual({ count: 1, credits: said })
    expect(after.total).toBe(before.total)
  })

  it('adds an Eleven Music take to the dollars alone', async () => {
    const before = await spending()
    await post('/api/music/tracks/hall/takes', { count: 1, model: 'eleven' })
    // The take is made in the background, and is spent once it is made.
    for (const giveUp = Date.now() + 4_000; (await spending()).takes === 0;) {
      if (Date.now() > giveUp) throw new Error('the take was never counted')
      await Bun.sleep(10)
    }

    const after = await spending()
    expect(after.total).toBeCloseTo(recordingDollars + musicDollars, 10)
    expect(after.credits).toBe(before.credits)
    expect(after.acts[0]!.total).toBeCloseTo(recordingDollars + musicDollars, 10)
    expect(after.rows.find((row) => row.kind === 'music')).toMatchObject({
      track: 'Hall',
      cost: expect.closeTo(musicDollars, 10),
      credits: 0,
    })
  })

  it('keeps what it showed in the studio’s spending record', () => {
    const record = JSON.parse(
      readFileSync(join(root, 'content-studio/cache/spending.json'), 'utf8'),
    ) as unknown
    expect(record).toMatchObject({
      recordings: [
        { part: 'act1', cost: expect.closeTo(recordingDollars, 10), credits: GUIDE.length },
      ],
      tries: [{ character: 'guide', credits: said }],
      music: [{ track: 'hall', cost: expect.closeTo(musicDollars, 10) }],
    })
  })
})
