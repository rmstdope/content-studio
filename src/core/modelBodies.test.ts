import { describe, expect, test } from 'bun:test'
import { bodyText } from './bodyText'
import { MODEL_BODIES, modelAllowed, type ModelKind } from './modelBodies'

const KINDS: [ModelKind, string[], string][] = [
  ['music', ['balanced', 'eleven'], 'balanced'],
  ['images', ['klein', 'qwen-image'], 'klein'],
  ['effects', ['small-sfx', 'open-1'], 'small-sfx'],
  ['fish', ['s2.1-pro', 'drama-3'], 's2.1-pro'],
  ['elevenlabs', ['eleven_v3'], 'eleven_v3'],
]

describe('model bodies', () => {
  for (const [kind, ids] of KINDS) {
    test(`${kind}: the body and the refusal name the ids and where was is read`, () => {
      for (const text of [bodyText(MODEL_BODIES[kind]), modelAllowed(kind)]) {
        for (const id of ids) expect(text).toContain(`"${id}"`)
        expect(text).toContain('GET /api/models')
      }
      expect(bodyText(MODEL_BODIES[kind])).toStartWith('{ model, was }')
    })
  }

  test('each save names the default for a file that names no model', () => {
    expect(modelAllowed('music')).toContain('"balanced" when the project file names none')
    expect(modelAllowed('elevenlabs')).toContain('"eleven_v3" when the project file names none')
    expect(modelAllowed('fish')).toContain('"s2.1-pro-free" when the project file names none')
  })

  test('fish leaves out the retired s1, which the save refuses', () => {
    expect(modelAllowed('fish')).not.toContain('"s1"')
  })
})
