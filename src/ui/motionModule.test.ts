import { describe, expect, it } from 'bun:test'
import { loadMotionModule } from './motionModule'

const good = `
export const EFFECT_TYPES = [
  { type: 'dust', title: 'Dust', spot: false, settings: [{ id: 'amount', title: 'Amount', min: 0, max: 3, step: 0.05, default: 1 }] },
]
export const createMotionScene = () => ({ marker: 'scene' })
`

describe('loadMotionModule', () => {
  it('loads the renderer’s effects and its scene maker', async () => {
    const loaded = await loadMotionModule(good)
    if (!('types' in loaded)) throw new Error(loaded.error)
    expect(loaded.types.map((t) => t.type)).toEqual(['dust'])
    expect(loaded.createScene()).toEqual({ marker: 'scene' })
  })

  it('says which export is missing', async () => {
    expect(await loadMotionModule(`export const createMotionScene = () => ({})`)).toEqual({
      error: 'the module does not export EFFECT_TYPES',
    })
    expect(await loadMotionModule(`export const EFFECT_TYPES = []`)).toEqual({
      error: 'the module does not export createMotionScene',
    })
  })

  it('says what is wrong with the effects', async () => {
    const loaded = await loadMotionModule(
      `export const EFFECT_TYPES = {}\nexport const createMotionScene = () => ({})`,
    )
    expect('error' in loaded && loaded.error).toContain('EFFECT_TYPES')
  })

  it('reports a module that throws when it loads', async () => {
    const loaded = await loadMotionModule(`throw new Error('boom')`)
    expect('error' in loaded && loaded.error).toContain('boom')
  })
})
