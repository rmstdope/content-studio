import { describe, expect, it } from 'bun:test'
import { effectsCount, imagesCount, musicCount, narrationCount } from './workspaceCounts'

const part = (id: string, title: string, dialog: string, lineCount = 0) =>
  ({ id, title, dialog, lineCount }) as Parameters<typeof narrationCount>[0][number]

describe('narrationCount', () => {
  const parts = [part('a1', 'Act I: One', 'ok', 5), part('a2', 'Act II: Two', 'ok', 4)]

  it('is nothing while the progress is not known, never a line total', () => {
    expect(narrationCount(parts, undefined, 'English')).toBeNull()
  })

  it('sums the lines that are ok over every act', () => {
    const c = narrationCount(
      parts,
      { a1: { ok: 5, lines: 5 }, a2: { ok: 3, lines: 4 } },
      'English',
    )!
    expect(c).toMatchObject({ text: '8/9', tone: 'most', warn: false, dot: 'some' })
    expect(c.tip).toBe('Lines that are ok in English, out of all, in every act')
    expect(c.railTip).toBe('Narration · 8/9 lines ok')
  })

  it('keeps a long count whole', () => {
    const c = narrationCount(
      [part('a1', 'Act I', 'ok')],
      { a1: { ok: 12880, lines: 12881 } },
      'English',
    )!
    expect(c.text).toBe('12880/12881')
  })

  it('leaves out an act that cannot be read, in the warning colour, saying which and why', () => {
    const c = narrationCount(
      [
        part('a1', 'Act I: One', 'ok'),
        part('a3', 'Act 3: Three', 'missing'),
        part('a4', 'Act 4', 'gone'),
      ],
      { a1: { ok: 1, lines: 2 } },
      'Svenska',
    )!
    expect(c).toMatchObject({ text: '1/2', warn: true })
    expect(c.tip).toBe(
      'Lines that are ok in Svenska, out of all, in every act\nAct 3 left out: no script\nAct 4 left out: dialog gone',
    )
  })

  it('leaves out an ok act missing from the answer as invalid', () => {
    const c = narrationCount(parts, { a1: { ok: 1, lines: 5 } }, 'English')!
    expect(c.warn).toBe(true)
    expect(c.tip).toContain('Act II left out: invalid')
  })

  it('shows 0/0 grey when there are no lines, and nothing when no act can be read', () => {
    expect(
      narrationCount([part('a1', 'Act I', 'ok')], { a1: { ok: 0, lines: 0 } }, 'English'),
    ).toMatchObject({
      text: '0/0',
      tone: null,
      dot: 'none',
    })
    expect(narrationCount([part('a1', 'Act I', 'missing')], {}, 'English')).toBeNull()
  })

  it('is green and a green dot when all are done', () => {
    expect(
      narrationCount(parts, { a1: { ok: 5, lines: 5 }, a2: { ok: 4, lines: 4 } }, 'English'),
    ).toMatchObject({
      tone: 'all',
      dot: 'all',
    })
  })
})

const track = (status: string) => ({ id: status, status })
const list = (id: string, kind: string, title: string, tracks: unknown[], state = 'ok') => ({
  id,
  kind,
  title,
  state,
  tracks,
})

describe('musicCount', () => {
  it('sums every act and the Stingers', () => {
    const c = musicCount({
      lists: [
        list('a1', 'act', 'Act I: One', [track('chosen'), track('changed')]),
        list('stingers', 'stingers', 'Stingers', [track('chosen')]),
      ],
    } as never)!
    expect(c).toMatchObject({ text: '2/3', tone: 'few', warn: false, dot: 'some' })
    expect(c.tip).toBe(
      'Tracks with a take chosen and up to date, out of all, in every act and the Stingers',
    )
    expect(c.railTip).toBe('Music · 2/3 tracks done')
  })

  it('has no count without a music section, and leaves out an unreadable list', () => {
    expect(musicCount(null)).toBeNull()
    const c = musicCount({
      lists: [
        list('a1', 'act', 'Act I: One', [track('chosen')]),
        list('stingers', 'stingers', 'Stingers', [], 'missing'),
        list('a2', 'act', 'Act II: Two', [], 'invalid'),
      ],
    } as never)!
    expect(c.warn).toBe(true)
    expect(c.tip).toContain('Stingers left out: no list')
    expect(c.tip).toContain('Act II left out: invalid')
    expect(musicCount({ lists: [list('a1', 'act', 'A', [], 'missing')] } as never)).toBeNull()
  })

  it('shows 0/0 grey when there are no tracks', () => {
    expect(musicCount({ lists: [list('a1', 'act', 'A', [])] } as never)).toMatchObject({
      text: '0/0',
      tone: null,
      dot: 'none',
    })
  })
})

describe('imagesCount', () => {
  const act = (id: string, state: string, statuses: string[]) => ({
    id,
    title: `Act ${id}: x`,
    state,
    rows: statuses.map((status, i) => ({ id: `${id}${i}`, status })),
    conflicts: [],
    order: [],
  })

  it('sums the finished images over every act', () => {
    const c = imagesCount({
      acts: [act('1', 'ok', ['chosen', 'none yet']), act('2', 'ok', ['chosen'])],
    } as never)!
    expect(c).toMatchObject({ text: '2/3', dot: 'some', warn: false })
    expect(c.tip).toBe('Images finished, out of all, in every act')
    expect(c.railTip).toBe('Images · 2/3 images finished')
  })

  it('has no count when unset, and warns for an act left out', () => {
    expect(imagesCount(null)).toBeNull()
    const c = imagesCount({ acts: [act('1', 'ok', ['chosen']), act('2', 'missing', [])] } as never)!
    expect(c.warn).toBe(true)
    expect(c.tip).toContain('Act 2 left out: no list')
  })
})

describe('effectsCount', () => {
  it('gives the dot and the folded tip of the existing count', () => {
    expect(
      effectsCount({ status: 'ok', done: { done: 120, total: 120, needs: [] } } as never),
    ).toMatchObject({
      dot: 'all',
      railTip: 'Sound effects · 120/120 sound effects done',
    })
    expect(effectsCount(null)).toBeNull()
    expect(effectsCount({ status: 'missing' } as never)).toBeNull()
  })
})
