// CST-3: a voice ruled out for a character stays ruled out for it and is not offered again; the
// character's page lists the voices ruled out.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditionSession } from '../../src/core/audition'
import type { RuledOutVoice } from '../../src/core/ruledOut'
import type { Voice } from '../../src/core/voiceSearch'
import { fish } from '../../src/server/test-support'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** A voice of Fish's library that both characters' keywords find. */
const calm = (id: string, title: string, uses: number): Voice => ({
  id,
  title,
  description: '',
  tags: ['calm'],
  languages: ['en'],
  uses,
  likes: 0,
  author: '',
  sample: null,
})

const LIBRARY = [calm('gravel', 'Gravel', 3), calm('silk', 'Silk', 2), calm('honey', 'Honey', 1)]

// One walk over one studio: each test goes on from what the ones before it made.
describe('CST-3: a voice ruled out for a character stays ruled out for it, and is listed', () => {
  const speaker = (voice: string) => ({ voice, audition: { keywords: ['calm'] } })
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson(),
      'content-studio/narration/cast.json': {
        speakers: { narrator: speaker('v1'), guide: speaker('v2') },
      },
      'tts/act1/script.json': [
        { id: 'a', speaker: 'narrator', text: 'The door opened.' },
        { id: 'g', speaker: 'guide', text: 'Follow me.' },
      ],
    },
    {
      fish: {
        ...fish,
        listVoices: async () => ({ total: LIBRARY.length, items: LIBRARY }),
      },
    },
  )

  const cast = () => readFileSync(join(root, 'content-studio/narration/cast.json'), 'utf8')
  const castAtStart = cast()

  /** What the audition page does: one of its requests, answering the board as it is after it. */
  async function board(character: string, action: string, body?: unknown) {
    const answer = await page.send('POST', `/api/auditions/${character}/${action}`, body)
    expect(answer.status).toBe(200)
    return ((await answer.json()) as { session: AuditionSession }).session
  }

  /** Starts an audition and brings voices in: what the character is offered. */
  async function offered(character: string) {
    expect((await board(character, 'start')).toHear).toEqual([])
    return board(character, 'more')
  }

  /** The voices the character's page lists as ruled out. */
  async function listed(character: string) {
    const answer = await page.get(`/api/characters/${character}/ruled-out`)
    const { voices } = (await answer.json()) as { voices: RuledOutVoice[] }
    return voices.map(({ id, title }) => `${id} ${title}`).sort()
  }

  it('takes a voice the person rules out off the board', async () => {
    expect((await offered('narrator')).toHear).toEqual(['gravel', 'silk', 'honey'])
    await board('narrator', 'move', { voice: 'gravel', move: 'drop' })
    const after = await board('narrator', 'move', { voice: 'silk', move: 'drop' })
    expect(after.toHear).toEqual(['honey'])
  })

  it('does not offer it again in a later audition of the character', async () => {
    expect((await page.send('DELETE', '/api/auditions/narrator')).status).toBe(200)

    const later = await offered('narrator')
    expect(later.toHear).toEqual(['honey'])
    expect(later.queue).toEqual([])
    expect(later.shortlist).toEqual(['v1'])
  })

  it('rules it out for that character alone', async () => {
    expect((await offered('guide')).toHear).toEqual(['gravel', 'silk', 'honey'])
  })

  it('lists the voices ruled out on the character’s page', async () => {
    expect(await listed('narrator')).toEqual(['gravel Gravel', 'silk Silk'])
    expect(await listed('guide')).toEqual([])
    expect(cast()).toBe(castAtStart)
  })
})
