import { describe, expect, it } from 'bun:test'
import { createMotionScene } from './renderer'

describe('the sample motion renderer', () => {
  it('ignores an effect kind it does not have', () => {
    const scene = createMotionScene()
    scene.setEffects([{ kind: 'gone', settings: { amount: 1 } }])
    expect(scene.isEmpty()).toBe(true)
  })

  it('still draws the kinds it has', () => {
    const scene = createMotionScene()
    scene.setEffects([{ kind: 'gone' }, { kind: 'dust' }])
    expect(scene.isEmpty()).toBe(false)
  })
})
