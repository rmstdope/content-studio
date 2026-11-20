import { describe, expect, it } from 'bun:test'
import { projectJson, tempRepo } from '../../test/helpers'
import { readPatchChoices } from './imageLists'

const board = (chosen: Record<string, number>, takes: object[]) => ({
  next: 9,
  takes: takes.map((t) => ({
    seed: 1,
    words: 'w',
    area: { x: 0, y: 0, width: 9, height: 9 },
    ...t,
  })),
  chosen,
  inGame: chosen,
})
const patches = [
  { id: 'vines', title: 'Vines cut' },
  { id: 'stick', title: 'Stick', over: 'vines' },
]
const boards = (stickOn: number) => ({
  'content-studio/cache/image-patches/inn/vines/board.json': board({ '1': 3 }, [{ n: 3, base: 1 }]),
  'content-studio/cache/image-patches/inn/stick/board.json': board({ '1': 2 }, [
    { n: 2, base: 1, under: { patch: 'vines', n: stickOn } },
  ]),
})

describe('the choices of patches that lie on top of others', () => {
  it('counts a take painted on what is underneath as chosen, and says what lies on what', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson({}), ...boards(3) })
    const read = await readPatchChoices(root, [{ id: 'inn', patches }])
    expect(read.patchChoices).toEqual({ inn: { vines: [1], stick: [1] } })
    expect(read.patchCarries).toEqual({ inn: { vines: { 3: ['stick'] } } })
    expect(read.patchChoice.inn!.stick![1]).toEqual({
      n: 2,
      valid: true,
      on: { patch: 'vines', n: 3 },
    })
  })
  it('sets aside a take painted on a take the patch underneath no longer has chosen', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson({}), ...boards(1) })
    const read = await readPatchChoices(root, [{ id: 'inn', patches }])
    expect(read.patchChoices).toEqual({ inn: { vines: [1] } })
    expect(read.patchChoice.inn!.stick![1]).toMatchObject({
      valid: false,
      on: { patch: 'vines', n: 1 },
    })
    // What was painted on take 1 is still known, for the question when take 1 is dropped.
    expect(read.patchCarries).toEqual({ inn: { vines: { 1: ['stick'] } } })
  })
})
