// CST-1: each character has one page with its cast voice, its lines per part, its delivery (style
// and speed) and the audition in progress, if there is one.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuditionSession } from '../../src/core/audition'
import type { ProjectSummary } from '../../src/core/summary'
import type { Voice } from '../../src/core/voiceSearch'
import { fish } from '../../src/server/test-support'
import { projectJson } from '../helpers'
import { startStudio } from './studio'

/** A voice as Fish knows it. */
const voiceOf = (id: string, title: string): Voice => ({
  id,
  title,
  description: '',
  tags: ['calm'],
  languages: ['en'],
  uses: 1,
  likes: 0,
  author: '',
  sample: null,
})

const GRAVEL = voiceOf('gravel', 'Gravel')
const SILK = voiceOf('silk', 'Silk')

const SCRIPTS = {
  act1: [
    { id: 'a', speaker: 'narrator', text: 'The door opened.' },
    { id: 'g', speaker: 'guide', text: 'Follow me.' },
    { id: 'b', speaker: 'narrator', text: 'Night fell.' },
  ],
  act2: [{ id: 'c', speaker: 'narrator', text: 'An owl called.' }],
}

// One walk over one studio: each test goes on from what the ones before it made.
describe('CST-1: a character has one page with its voice, lines, delivery and audition', () => {
  const guide = { voice: 'silk', voiceName: 'Silk' }
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson(),
      'content-studio/narration/cast.json': {
        speakers: {
          narrator: {
            voice: 'gravel',
            voiceName: 'Gravel',
            style: 'slow and low',
            speed: 0.9,
            audition: { keywords: ['calm'] },
          },
          guide,
        },
      },
      'tts/act1/script.json': SCRIPTS.act1,
      'tts/act2/script.json': SCRIPTS.act2,
    },
    {
      fish: {
        ...fish,
        getVoice: async (id) => {
          const found = [GRAVEL, SILK].find((voice) => voice.id === id)
          if (!found) throw new Error(`no voice ${id}`)
          return found
        },
        listVoices: async () => ({ total: 2, items: [GRAVEL, SILK] }),
      },
    },
  )

  const file = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
  const cast = () => file('content-studio/narration/cast.json').speakers

  /** What the page asks for, answered. */
  async function read<T>(path: string) {
    const answer = await page.get(path)
    expect(answer.status).toBe(200)
    return (await answer.json()) as T
  }

  /** The characters as the studio's pages are told of them: one entry, one page, for each. */
  async function characters() {
    const answer = await read<{ ok: true; summary: ProjectSummary }>('/api/project')
    return answer.summary.characters
  }

  const narrator = async () => (await characters()).find((c) => c.id === 'narrator')!

  /** The audition in progress as the character's page asks for it. */
  const audition = async (character: string) =>
    (await read<{ session: AuditionSession | null }>(`/api/auditions/${character}`)).session

  it('has one page for the character, with its cast voice', async () => {
    expect((await characters()).map((c) => c.id).sort()).toEqual(['guide', 'narrator'])
    expect(await narrator()).toMatchObject({ voice: 'gravel', voiceName: 'Gravel' })
    expect(await read('/api/characters/narrator/voice')).toMatchObject({
      ok: true,
      id: 'gravel',
      voice: { title: 'Gravel' },
    })
  })

  it('has its lines per part', async () => {
    const { appearances, totalLines } = await narrator()
    expect(appearances).toEqual([
      { part: 'act1', lines: 2 },
      { part: 'act2', lines: 1 },
    ])
    expect(totalLines).toBe(3)
    // The lines the page lists, from each part it appears in.
    const texts: string[][] = []
    for (const { part } of appearances) {
      const shown = await read<{ part: { lines: { speaker: string; text: string }[] } }>(
        `/api/parts/${part}`,
      )
      texts.push(shown.part.lines.filter((l) => l.speaker === 'narrator').map((l) => l.text))
    }
    expect(texts).toEqual([['The door opened.', 'Night fell.'], ['An owl called.']])
  })

  it('has its delivery, style and speed, as the game’s cast holds it', async () => {
    expect(await narrator()).toMatchObject({ style: 'slow and low', speed: 0.9 })

    for (const change of [{ style: 'bright and quick' }, { speed: 1.2 }]) {
      const saved = await page.send('PATCH', '/api/characters/narrator', change)
      expect(saved.status).toBe(200)
    }

    expect(await narrator()).toMatchObject({ style: 'bright and quick', speed: 1.2 })
    expect(cast().narrator).toMatchObject({
      voice: 'gravel',
      style: 'bright and quick',
      speed: 1.2,
    })
    expect(cast().guide).toEqual(guide)
  })

  it('has the audition in progress, once there is one', async () => {
    expect(await audition('narrator')).toBeNull()
    const before = cast()

    for (const action of ['start', 'more']) {
      const answer = await page.send('POST', `/api/auditions/narrator/${action}`)
      expect(answer.status).toBe(200)
    }

    expect(await audition('narrator')).toMatchObject({ shortlist: ['gravel'], toHear: ['silk'] })
    expect(await audition('guide')).toBeNull()
    // An audition changes nothing in the game until a voice is cast.
    expect(cast()).toEqual(before)
    expect(file('tts/act1/script.json')).toEqual(SCRIPTS.act1)
    expect(file('tts/act2/script.json')).toEqual(SCRIPTS.act2)
  })
})
