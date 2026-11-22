import { describe, expect, it } from 'bun:test'
import {
  CopyImageBody,
  NO_COPY_MATCH,
  copiedLine,
  copyFailure,
  copyFooter,
  copySources,
  copyWindowTitle,
  filterCopySources,
  type CopySourceRow,
} from './imageCopy'

const row = (
  id: string,
  chosenTake: number | null,
  width = 320,
  height = 200,
  title = id,
): CopySourceRow => ({ id, title, chosenTake, width, height })

const acts = [
  {
    id: 'a1',
    title: 'Act One',
    rows: [row('lantern', 3), row('lantern-lit', null), row('door', 1)],
  },
  { id: 'a2', title: 'Act Two', rows: [row('lantern', 3), row('tiny', null)] },
  { id: 'a3', title: 'Act Three', rows: [row('wide', 2, 640, 200, 'Wide hall')] },
]

describe('copySources', () => {
  it('lists the images with a chosen take, by act in the game order, never the image itself', () => {
    const groups = copySources(acts, 'lantern-lit')
    expect(groups.map((g) => [g.title, g.images.map((i) => i.id)])).toEqual([
      ['Act One', ['lantern', 'door']],
      ['Act Three', ['wide']],
    ])
  })
  it('leaves the image itself out and an act with nothing to copy', () => {
    expect(copySources(acts, 'lantern').map((g) => g.title)).toEqual(['Act One', 'Act Three'])
    expect(copySources(acts, 'lantern')[0]!.images.map((i) => i.id)).toEqual(['door'])
  })
  it('lists a shared image once, under the first act that lists it', () => {
    const all = copySources(acts, 'x').flatMap((g) => g.images.map((i) => i.id))
    expect(all.filter((id) => id === 'lantern')).toHaveLength(1)
  })
  it('says which take is in the game and marks another shape as cropped', () => {
    const wide = copySources(acts, 'lantern-lit', { width: 320, height: 200 })[1]!.images[0]!
    expect(wide).toMatchObject({ id: 'wide', take: 2, cropped: true, size: '640 × 200' })
    expect(
      copySources(acts, 'lantern-lit', { width: 320, height: 200 })[0]!.images[0]!.cropped,
    ).toBe(false)
  })
})

describe('filterCopySources', () => {
  const groups = copySources(acts, 'lantern-lit')
  it('narrows by title, case-insensitively, and drops acts left with no match', () => {
    expect(filterCopySources(groups, 'WIDE').map((g) => g.title)).toEqual(['Act Three'])
    expect(filterCopySources(groups, '  ').length).toBe(2)
    expect(filterCopySources(groups, 'zzz')).toEqual([])
  })
})

describe('the words', () => {
  it('are the ones agreed', () => {
    expect(copyWindowTitle('Lit lantern')).toBe('Copy another image into Lit lantern')
    expect(copyFooter('Lantern', 3)).toBe(
      'Lantern · Take 3 — its picture only. Its patches and named areas stay with it.',
    )
    expect(copiedLine('Lantern', 4)).toBe(
      "Copied Lantern's picture as Take 4. Choose it, then fine-tune it on the Fine-tune tab.",
    )
    expect(copyFailure('Lantern', 'the picture is gone')).toBe(
      "Lantern's picture could not be copied: the picture is gone. Nothing was added; try again.",
    )
    expect(NO_COPY_MATCH('cat')).toBe('No image matches “cat”.')
  })
})

describe('CopyImageBody', () => {
  it('wants the source image and nothing else', () => {
    expect(CopyImageBody.safeParse({ from: 'door' }).success).toBe(true)
    expect(CopyImageBody.safeParse({ from: '' }).success).toBe(false)
    expect(CopyImageBody.safeParse({ from: 'a', extra: 1 }).success).toBe(false)
  })
})
