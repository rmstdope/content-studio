// NAR-1: the person records the narration of one character or of a whole part, in each language the
// game declares. Only lines that are missing or whose inputs changed are recorded; clips whose line
// left the script are removed.
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fish } from '../../src/server/test-support'
import { narrationInLanguages, projectJson } from '../helpers'
import { jobEnded, startStudio, wavOf } from './studio'

type Language = 'en' | 'sv'

/** A script of `[key, speaker, text]` rows, as the game writes it. */
const script = (...rows: [string, string, string][]) =>
  rows.map(([id, speaker, text]) => ({ id, speaker, text }))

const ENGLISH = script(
  ['a1', 'narrator', 'The door opened.'],
  ['a2', 'narrator', 'Night fell.'],
  ['g1', 'guide', 'Follow me.'],
  ['g2', 'guide', 'Mind the step.'],
)
const SWEDISH = script(
  ['a1', 'narrator', 'Dörren öppnades.'],
  ['a2', 'narrator', 'Natten föll.'],
  ['g1', 'guide', 'Följ mig.'],
  ['g2', 'guide', 'Se upp för steget.'],
)

// One walk over one studio: each test goes on from what the ones before it made.
describe('NAR-1: a character or a whole part is recorded, in each language, as the script says', () => {
  /** What Fish has been asked to say since the last recording was looked at. */
  const spoken: string[] = []
  let takes = 0
  const { root, page } = startStudio(
    {
      'content-studio.json': projectJson({
        languages: ['en', 'sv'],
        narration: narrationInLanguages(),
      }),
      // A language besides the source is cast on its own.
      'content-studio/narration/cast.json': {
        speakers: {
          narrator: { voice: 'en-narrator', languages: { sv: { voice: 'sv-narrator' } } },
          guide: { voice: 'en-guide', languages: { sv: { voice: 'sv-guide' } } },
        },
      },
      'tts/act1/en/script.json': ENGLISH,
      'tts/act1/sv/script.json': SWEDISH,
    },
    {
      fish: {
        ...fish,
        // Each take is a second longer than the one before, so no two clips are alike.
        async tts(request) {
          spoken.push(request.text)
          return wavOf(++takes)
        },
      },
    },
  )

  /** The game rewrites a language's script. */
  const rewrite = (language: Language, lines: ReturnType<typeof script>) =>
    writeFileSync(join(root, `tts/act1/${language}/script.json`), JSON.stringify(lines))

  /** The clips of a language as the game has them: each line of its manifest, with its audio. */
  function game(language: Language): Record<string, string> {
    const folder = join(root, 'audio/act1', language)
    if (!existsSync(join(folder, 'manifest.json'))) return {}
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as Record<
      string,
      { file: string }
    >
    return Object.fromEntries(
      Object.entries(manifest).map(([key, { file }]) => [
        key,
        readFileSync(join(folder, file)).toString('base64'),
      ]),
    )
  }
  const clipExists = (language: Language, key: string) =>
    existsSync(join(root, `audio/act1/${language}/${key}.mp3`))

  /**
   * Records as the page does: it shows the plan for the language and the character (or the whole
   * part), and the person starts what it shows. Answers what Fish was asked to say.
   */
  async function record(language: Language, speaker: string | null = null): Promise<string[]> {
    const query = `?language=${language}`
    const shown = await page.get(
      `/api/parts/act1/plan${query}${speaker ? `&speaker=${speaker}` : ''}`,
    )
    const { plan } = (await shown.json()) as { plan: { keys: string[]; orphans: string[] } }
    const started = await page.send('POST', `/api/parts/act1/jobs${query}`, {
      speaker,
      keys: plan.keys,
      orphans: plan.orphans,
    })
    expect(started.status).toBe(200)
    const { id } = (await started.json()) as { id: string }
    expect(await jobEnded(page, id)).toMatchObject({ status: 'done', failed: [] })
    return spoken.splice(0).sort()
  }

  it('records one character’s lines alone, then only what the whole part still misses', async () => {
    expect(await record('en', 'guide')).toEqual(['Follow me.', 'Mind the step.'])
    const guides = game('en')
    expect(Object.keys(guides).sort()).toEqual(['g1', 'g2'])

    expect(await record('en')).toEqual(['Night fell.', 'The door opened.'])
    expect(Object.keys(game('en')).sort()).toEqual(['a1', 'a2', 'g1', 'g2'])
    expect(game('en')).toMatchObject(guides)
    expect(game('sv')).toEqual({})
  })

  it('records the other language into its own clips', async () => {
    const english = game('en')
    expect(await record('sv')).toEqual([
      'Dörren öppnades.',
      'Följ mig.',
      'Natten föll.',
      'Se upp för steget.',
    ])
    expect(Object.keys(game('sv')).sort()).toEqual(['a1', 'a2', 'g1', 'g2'])
    expect(game('en')).toEqual(english)
  })

  it('records a character’s new and changed lines, and removes its clips whose line left', async () => {
    const english = game('en')
    const swedish = game('sv')
    // a1 and g1 are reworded, a3 is new, a2 and g2 leave the script.
    rewrite(
      'en',
      script(
        ['a1', 'narrator', 'The door creaked open.'],
        ['a3', 'narrator', 'An owl called.'],
        ['g1', 'guide', 'Follow me closely.'],
      ),
    )

    expect(await record('en', 'narrator')).toEqual(['An owl called.', 'The door creaked open.'])
    const after = game('en')
    expect(Object.keys(after).sort()).toEqual(['a1', 'a3', 'g1', 'g2'])
    expect(after.a1).not.toBe(english.a1)
    expect(clipExists('en', 'a2')).toBe(false)
    // The guide's clips are not this recording's to touch.
    expect([after.g1, after.g2]).toEqual([english.g1!, english.g2!])
    expect(game('sv')).toEqual(swedish)
  })

  it('then does the rest of the part, and has nothing left to do', async () => {
    const before = game('en')
    const swedish = game('sv')

    expect(await record('en')).toEqual(['Follow me closely.'])
    const after = game('en')
    expect(Object.keys(after).sort()).toEqual(['a1', 'a3', 'g1'])
    expect(after.g1).not.toBe(before.g1)
    expect([after.a1, after.a3]).toEqual([before.a1!, before.a3!])
    expect(clipExists('en', 'g2')).toBe(false)
    expect(game('sv')).toEqual(swedish)

    // Every line has its clip now: even asked for them all, the studio records none.
    const again = await page.send('POST', '/api/parts/act1/jobs?language=en', {
      speaker: null,
      keys: ['a1', 'a3', 'g1'],
      orphans: [],
    })
    expect(again.status).toBe(409)
    expect(spoken).toEqual([])
  })

  it('removes the other language’s clip when the line leaves that script', async () => {
    const english = game('en')
    const swedish = game('sv')
    rewrite(
      'sv',
      SWEDISH.filter((line) => line.id !== 'a2'),
    )

    expect(await record('sv')).toEqual([])
    const { a2: gone, ...kept } = swedish
    expect(gone).toBeDefined()
    expect(game('sv')).toEqual(kept)
    expect(clipExists('sv', 'a2')).toBe(false)
    expect(game('en')).toEqual(english)
  })
})
