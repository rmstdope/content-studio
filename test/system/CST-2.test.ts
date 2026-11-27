// CST-2: the person auditions voices for a character (found by keywords in Fish Audio's or
// ElevenLabs' library, their own voices, a cloned voice or a designed one) by hearing each say
// the audition phrase, shortlisting some and ruling others out, and casts one.
//
// The fakes' audio is text naming who says what, so what the page plays is told apart.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditionSession } from '../../src/core/audition'
import type { RuledOutVoice } from '../../src/core/ruledOut'
import type { Voice } from '../../src/core/voiceSearch'
import { fish } from '../../src/server/test-support'
import { elevenVoiceOf, fakeEleven, projectJson } from '../helpers'
import { startStudio } from './studio'

const PHRASE = 'The lantern flickered twice.'

/** A voice as Fish knows it. */
const voiceOf = (id: string, title: string): Voice => ({
  id,
  title,
  description: '',
  tags: [],
  languages: ['en'],
  uses: 1,
  likes: 0,
  author: '',
  sample: null,
})

/** What the character's keywords find in Fish's library. */
const LIBRARY = [
  { ...voiceOf('gravel', 'Gravel'), tags: ['calm'], uses: 2 },
  { ...voiceOf('silk', 'Silk'), tags: ['calm'] },
]
const MINE = { ...voiceOf('mine', 'My Voice'), own: true }

const bytes = (text: string) => new TextEncoder().encode(text)
const said = (voice: string, text: string) => `${voice} says: ${text}`

// One walk over one studio: each test goes on from what the ones before it made.
describe('CST-2: voices are auditioned for a character, and one is cast', () => {
  /** The voices on the person's Fish account. */
  const account: Voice[] = [MINE]
  /** The recordings each voice cloned on the account was made from. */
  const recordings: string[][] = []

  const eleven = fakeEleven(
    {},
    {
      account: {
        tier: 'creator',
        charactersUsed: 0,
        characterLimit: 100_000,
        renewsAt: null,
        overage: 0,
        voiceSlots: { used: 0, limit: 30 },
      },
    },
  )
  eleven.client.sharedVoices = async ({ search }) => ({
    voices:
      search === 'calm'
        ? [
            {
              ...elevenVoiceOf('lib', 'Cedar'),
              tags: ['calm'],
              library: { owner: 'o1', added: false },
            },
          ]
        : [],
    more: false,
  })
  eleven.client.addSharedVoice = async (_owner, id) => `own-${id}`
  eleven.client.tts = async ({ voice, text }) => bytes(said(voice, text))

  const { root, url, page } = startStudio(
    {
      'content-studio.json': projectJson({
        narration: {
          ...(projectJson().narration as object),
          audition: { phrase: { en: PHRASE } },
        },
      }),
      'content-studio/narration/cast.json': {
        speakers: { narrator: { audition: { keywords: ['calm'] } } },
      },
      'tts/act1/script.json': [{ id: 'a', speaker: 'narrator', text: 'The door opened.' }],
    },
    {
      fish: {
        ...fish,
        listVoices: async ({ title }) => {
          const items = title === 'calm' ? LIBRARY : []
          return { total: items.length, items }
        },
        listOwnVoices: async () => [...account],
        getVoice: async (id) => {
          const found = [...LIBRARY, ...account].find((voice) => voice.id === id)
          if (!found) throw new Error(`no voice ${id}`)
          return found
        },
        createVoice: async ({ title, files }) => {
          recordings.push(files.map((file) => new TextDecoder().decode(file.bytes)))
          const voice = { ...voiceOf('cloned', title), own: true }
          account.push(voice)
          return voice
        },
        designVoice: async ({ referenceText }) =>
          ['a', 'b'].map((id) => ({ id, wav: bytes(said(`design ${id}`, referenceText)) })),
        tts: async ({ voice, text }) => bytes(said(voice, text)),
      },
      elevenlabs: eleven.client,
    },
  )

  const cast = () => readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8')
  const castAtStart = cast()

  /** The board as the audition page is told of it. */
  interface Board {
    session: AuditionSession
    takes: Record<string, string>
  }

  /** One of the audition page's requests, answering the board as it is after it. */
  async function board(action: string, body?: unknown) {
    const answer = await page.send('POST', `/api/auditions/narrator/${action}`, body)
    expect(answer.status).toBe(200)
    return (await answer.json()) as Board
  }

  const shown = async () => (await (await page.get('/api/auditions/narrator')).json()) as Board

  /** What the page plays for the take `key`. */
  const played = async (key: string) => (await page.get(`/api/takes/${key}.mp3`)).text()

  /** The ids of the designed voices on the board. */
  let designed: string[] = []

  it('finds voices by the character’s keywords in Fish’s and ElevenLabs’ libraries', async () => {
    expect((await board('start')).session.toHear).toEqual([])
    expect((await board('more', { provider: 'fish' })).session.toHear).toEqual(['gravel', 'silk'])
    const after = await board('more', { provider: 'elevenlabs' })
    expect(after.session.toHear).toEqual(['gravel', 'silk', 'eleven:lib'])
  })

  it('has the person’s own voices', async () => {
    expect((await board('own')).session.yours).toEqual(['mine'])
  })

  it('takes a voice cloned from recordings', async () => {
    const form = new FormData()
    form.set('title', 'Grandad')
    form.append('voices', new File(['a recording of Grandad'], 'grandad.wav'))
    const answer = await fetch(new URL('/api/characters/narrator/clone-voice', url), {
      method: 'POST',
      headers: { origin: url.origin },
      body: form,
    })
    expect(await answer.json()).toMatchObject({ ok: true, voice: { id: 'cloned' } })
    expect(recordings).toEqual([['a recording of Grandad']])

    const after = await board('add', { voice: 'cloned' })
    expect(after.session.toHear).toContain('cloned')
    expect(after.session.voices.cloned).toMatchObject({ title: 'Grandad' })
  })

  it('takes voices designed from a description, each saying the audition phrase', async () => {
    const answer = await page.send('POST', '/api/characters/narrator/design', {
      description: 'An old storyteller with a low, warm voice.',
      spendUpTo: 0.01,
    })
    expect(await answer.json()).toMatchObject({ ok: true, added: 2 })

    const { session, takes } = await shown()
    designed = session.designed
    expect(designed).toHaveLength(2)
    expect(await Promise.all(designed.map((id) => played(takes[id]!)))).toEqual([
      said('design a', PHRASE),
      said('design b', PHRASE),
    ])
  })

  it('lets the person hear every other voice say the audition phrase', async () => {
    // An ElevenLabs voice's take costs credits, which the person gives the audition.
    await board('sitting/add', { credits: 300 })
    // Each voice on the board, by the id its provider speaks it with.
    const voices = {
      gravel: 'gravel',
      silk: 'silk',
      'eleven:lib': 'own-lib',
      mine: 'mine',
      cloned: 'cloned',
    }
    for (const [voice, speaker] of Object.entries(voices)) {
      const answer = await page.send('POST', '/api/characters/narrator/takes', {
        voice,
        board: true,
      })
      const take = (await answer.json()) as { ok: boolean; key: string }
      expect(take).toMatchObject({ ok: true })
      expect(await played(take.key)).toBe(said(speaker, PHRASE))
      // The board shows the take again when the page is opened later.
      expect((await shown()).takes[voice]).toBe(take.key)
    }
  })

  it('shortlists some voices and rules others out', async () => {
    const shortlisted = ['silk', 'eleven:lib', 'mine', 'cloned', designed[0]!]
    for (const voice of shortlisted) await board('move', { voice, move: 'shortlist' })
    for (const voice of ['gravel', designed[1]!]) await board('move', { voice, move: 'drop' })

    const { session } = await shown()
    expect(session).toMatchObject({ shortlist: shortlisted, toHear: [], yours: [], designed: [] })
    const answer = await page.get('/api/characters/narrator/ruled-out')
    const { voices } = (await answer.json()) as { voices: RuledOutVoice[] }
    expect(voices.map(({ id }) => id).sort()).toEqual([designed[1]!, 'gravel'].sort())
    // Nothing of the cast changes until a voice is cast.
    expect(cast()).toBe(castAtStart)
  })

  it('casts the one the person picks', async () => {
    const answer = await page.send('POST', '/api/auditions/narrator/cast', { voice: 'silk' })
    expect(await answer.json()).toMatchObject({ ok: true, voice: { id: 'silk', name: 'Silk' } })

    expect(JSON.parse(cast()).speakers.narrator).toEqual({
      audition: { keywords: ['calm'] },
      voice: 'silk',
      voiceName: 'Silk',
    })
    expect((await shown()).session).toBeNull()
  })
})
