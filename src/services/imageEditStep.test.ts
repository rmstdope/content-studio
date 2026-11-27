import { describe, expect, it } from 'bun:test'
import { tempRepo } from '../../test/helpers'
import { editStep, queuedAnswer } from './imageEditStep'
import type { ImageGenerator } from './images'
import { fakePng } from './imagesFake'
import { decodePng } from './png'
import { createSerial, type Serial } from './serial'

const made: number[] = []
const generator: ImageGenerator = {
  ready: () => ({ ok: true }),
  installed: () => true,
  generate: async (request) => {
    made.push(request.seed)
    return { png: fakePng(request.width, request.height, 1), seed: request.seed }
  },
}

describe('editStep', () => {
  it('takes its turn on the queue at once, so edits asked in order are made in that order', async () => {
    const root = tempRepo({})
    const source = decodePng(fakePng(64, 64, 2))
    const turns: string[] = []
    const serial = createSerial()
    const queue: Serial = {
      run: (key, job) => {
        turns.push(key)
        return serial.run(key, job)
      },
    }
    const step = (n: number) => ({
      root,
      cropFile: `editing-${n}.png`,
      source,
      area: null,
      words: 'x',
      model: 'klein' as const,
      seed: n,
    })
    const deps = { generator, queue, free: () => {} }
    const first = editStep(deps, step(1), new AbortController().signal, () => {})
    const second = editStep(deps, step(2), new AbortController().signal, () => {})
    // Nothing awaited yet: both are already in line, in the order asked.
    expect(turns).toHaveLength(2)
    await Promise.all([first, second])
    expect(made).toEqual([1, 2])
  })
})

describe('queuedAnswer', () => {
  const picture = { width: 1024, height: 576 }

  it('warns about a mark too small for the model', () => {
    const area = { x: 0, y: 0, width: 36, height: 30 }
    expect(queuedAnswer({ count: 2, area }, picture)).toEqual({
      ok: true,
      warning: 'Too small: 36 × 30. Make it at least 50 × 50, or the model may change nothing.',
    })
  })

  it('has no warning for a big enough mark, no mark, or one over the whole picture', () => {
    const big = { x: 0, y: 0, width: 50, height: 50 }
    expect(queuedAnswer({ count: 1, area: big }, picture)).toEqual({ ok: true })
    expect(queuedAnswer({ count: 1, area: null }, picture)).toEqual({ ok: true })
    const narrow = { width: 40, height: 600 }
    const whole = { x: 0, y: 0, ...narrow }
    expect(queuedAnswer({ count: 1, area: whole }, narrow)).toEqual({ ok: true })
  })

  it('has no warning for a retry, which carries no mark', () => {
    expect(queuedAnswer({ retry: 3 }, picture)).toEqual({ ok: true })
  })
})
