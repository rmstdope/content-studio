import { describe, expect, it } from 'bun:test'
import { EFFECT_TYPES, createMotionScene } from './renderer'

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

/** A drawing context that only notes the calls that shape and clip what is drawn. */
function notingContext() {
  const calls: string[] = []
  const note =
    (name: string) =>
    (...args: number[]) =>
      calls.push(args.length ? `${name} ${args.map((n) => Math.round(n)).join(' ')}` : name)
  const ctx = {
    clearRect: () => {},
    beginPath: note('beginPath'),
    moveTo: note('moveTo'),
    lineTo: note('lineTo'),
    closePath: note('closePath'),
    clip: note('clip'),
    save: note('save'),
    restore: note('restore'),
    arc: () => {},
    fill: () => {},
    fillStyle: '',
  }
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D }
}

describe('the sample motion renderer with a spot', () => {
  it('draws an effect with a spot only inside its shapes, at the canvas size', () => {
    const scene = createMotionScene()
    scene.resize(200, 100)
    scene.setEffects([
      {
        kind: 'dust',
        spot: [
          [
            [0.1, 0.5],
            [0.4, 0.5],
            [0.25, 0.9],
          ],
        ],
      },
    ])
    const { calls, ctx } = notingContext()
    scene.draw(ctx)
    expect(calls.slice(0, 7)).toEqual([
      'save',
      'beginPath',
      'moveTo 20 50',
      'lineTo 80 50',
      'lineTo 50 90',
      'closePath',
      'clip',
    ])
    expect(calls).toContain('restore')
  })

  it('draws an effect with no spot inside the game’s own shape, at the canvas size', () => {
    const scene = createMotionScene()
    scene.resize(200, 100)
    scene.setEffects([{ kind: 'dust' }])
    const { calls, ctx } = notingContext()
    scene.draw(ctx)
    expect(calls.slice(0, 4)).toEqual(['save', 'beginPath', 'moveTo 10 60', 'lineTo 190 60'])
  })

  it('draws an effect the game places over the whole picture unclipped', () => {
    const scene = createMotionScene()
    scene.setEffects([{ kind: 'embers' }])
    const { calls, ctx } = notingContext()
    scene.draw(ctx)
    expect(calls).not.toContain('clip')
  })
})

/** A drawing context that notes each fill's colour and kind, to see what is painted and in what order. */
function fillingContext() {
  const fills: string[] = []
  const state = { fillStyle: '' }
  const ctx = {
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    arc: () => {},
    stroke: () => {},
    fillRect: () => fills.push(`rect ${state.fillStyle}`),
    fill: () => fills.push(`fill ${state.fillStyle}`),
    set fillStyle(value: string) {
      state.fillStyle = value
    },
    get fillStyle() {
      return state.fillStyle
    },
    strokeStyle: '',
    lineWidth: 1,
  }
  return { fills, ctx: ctx as unknown as CanvasRenderingContext2D }
}

describe('the sample’s ripples', () => {
  it('is an effect the renderer offers', () => {
    expect(EFFECT_TYPES.map((t) => t.type)).toContain('ripples')
  })

  it('paints its spot opaque, and first, even when listed after the others', () => {
    const scene = createMotionScene()
    scene.resize(200, 100)
    scene.setEffects([{ kind: 'embers' }, { kind: 'ripples' }])
    const { fills, ctx } = fillingContext()
    scene.draw(ctx)
    expect(fills[0]).toBe('fill #1d4e6b')
    expect(fills).toContain('fill #ff9a3d')
  })

  it('is not empty when switched on', () => {
    const scene = createMotionScene()
    scene.setEffects([{ kind: 'ripples' }])
    expect(scene.isEmpty()).toBe(false)
  })
})
