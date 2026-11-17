import { describe, expect, it } from 'bun:test'
import { numberText, parseEffectTypes, settingLine, settingsLine, startSettings } from './motion'

const setting = (over: Record<string, unknown> = {}) => ({
  id: 'amount',
  title: 'Amount',
  min: 0,
  max: 3,
  step: 0.05,
  default: 1,
  ...over,
})
const effect = (over: Record<string, unknown> = {}) => ({
  type: 'dust',
  title: 'Dust',
  spot: false,
  settings: [setting(), setting({ id: 'speed', title: 'Speed' })],
  ...over,
})

describe('parseEffectTypes', () => {
  it('reads what the renderer reports, in its order', () => {
    const answer = parseEffectTypes([effect(), effect({ type: 'fire', title: 'Fire', spot: true })])
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.types.map((t) => t.type)).toEqual(['dust', 'fire'])
    expect(answer.types[1]!.spot).toBe(true)
  })

  it('accepts a renderer with no effects', () => {
    expect(parseEffectTypes([])).toEqual({ ok: true, types: [] })
  })

  it('refuses what is not a list of effects, saying what is wrong', () => {
    const answer = parseEffectTypes({ dust: 1 })
    expect(answer.ok).toBe(false)
    if (answer.ok) return
    expect(answer.message).toContain('EFFECT_TYPES')
  })

  it('refuses a setting whose start is outside its range, naming the effect and setting', () => {
    const answer = parseEffectTypes([effect({ settings: [setting({ default: 5 })] })])
    expect(answer.ok).toBe(false)
    if (answer.ok) return
    expect(answer.message).toContain('dust')
    expect(answer.message).toContain('amount')
  })

  it('refuses two effects of one type', () => {
    const answer = parseEffectTypes([effect(), effect()])
    expect(answer.ok).toBe(false)
    if (answer.ok) return
    expect(answer.message).toContain('dust')
  })
})

describe('the words of an effect', () => {
  it('writes a setting as name, range and starting value', () => {
    expect(settingLine(setting())).toBe('Amount 0–3 (1)')
    expect(settingLine(setting({ title: 'Glow', max: 2, default: 0.5 }))).toBe('Glow 0–2 (0.5)')
  })

  it('joins an effect’s settings with a dot', () => {
    const answer = parseEffectTypes([
      effect({
        settings: [setting(), setting({ id: 'size', title: 'Size' }), setting({ title: 'Speed' })],
      }),
    ])
    if (!answer.ok) throw new Error('unreadable')
    expect(settingsLine(answer.types[0]!)).toBe('Amount 0–3 (1) · Size 0–3 (1) · Speed 0–3 (1)')
  })

  it('starts every setting at its starting value', () => {
    const answer = parseEffectTypes([
      effect({ settings: [setting(), setting({ id: 'glow', default: 0.5 })] }),
    ])
    if (!answer.ok) throw new Error('unreadable')
    expect(startSettings(answer.types[0]!)).toEqual({ amount: 1, glow: 0.5 })
  })

  it('writes numbers without trailing zeros', () => {
    expect(numberText(1)).toBe('1')
    expect(numberText(0.25)).toBe('0.25')
    expect(numberText(0.1 + 0.2)).toBe('0.3')
  })
})
