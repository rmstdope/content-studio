import { describe, expect, it } from 'bun:test'
import {
  clampSetting,
  effectDiffers,
  effectValues,
  rangeNote,
  valueText,
  numberText,
  parseEffectTypes,
  settingLine,
  settingsLine,
  startSettings,
  effectPlays,
  tieState,
} from './motion'

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

describe('an effect’s saved settings', () => {
  const size = setting({ id: 'size', title: 'Size', max: 2, min: 0.5, default: 1 })
  const amount = setting()
  const read = () => {
    const answer = parseEffectTypes([effect({ settings: [amount, size] })])
    if (!answer.ok) throw new Error('unreadable')
    return answer.types[0]!
  }

  it('writes a value as a plain number with two decimals', () => {
    expect(valueText(1.25)).toBe('1.25')
    expect(valueText(2)).toBe('2.00')
  })

  it('holds a value to the setting’s range', () => {
    expect(clampSetting(size, 2.5)).toBe(2)
    expect(clampSetting(size, 0.1)).toBe(0.5)
    expect(clampSetting(size, 1.5)).toBe(1.5)
  })

  it('takes the saved value, the starting value where none is saved, each held to its range', () => {
    expect(effectValues(read(), { amount: 1.25 })).toEqual({ amount: 1.25, size: 1 })
    expect(effectValues(read(), { size: 9 })).toEqual({ amount: 1, size: 2 })
    expect(effectValues(read(), undefined)).toEqual({ amount: 1, size: 1 })
  })

  it('differs from the start only when a setting is not at its starting value', () => {
    expect(effectDiffers(read(), undefined)).toBe(false)
    expect(effectDiffers(read(), { amount: 1, size: 1 })).toBe(false)
    expect(effectDiffers(read(), { amount: 1.25 })).toBe(true)
  })

  it('says when a saved value is outside the range now, and the end the game plays', () => {
    expect(rangeNote(size, 2.5)).toBe(
      'Size was saved as 2.50; the renderer now goes up to 2, so the game plays 2.',
    )
    expect(rangeNote(size, 0.25)).toBe(
      'Size was saved as 0.25; the renderer now goes down to 0.5, so the game plays 0.5.',
    )
    expect(rangeNote(size, 1.5)).toBeNull()
    expect(rangeNote(size, undefined)).toBeNull()
  })
})

describe('what an effect tied to a patch does', () => {
  const patches = [
    { id: 'star', title: 'The star on the door', hasTake: true },
    { id: 'lantern', title: 'Broken lantern', hasTake: false },
  ]
  const none = new Set<string>()

  it('always shows when it is not tied', () => {
    expect(tieState({}, patches, none)).toEqual({ kind: 'always' })
    expect(effectPlays({ kind: 'always' })).toBe(true)
  })

  it('shows only while the tied patch is laid', () => {
    const saved = { patch: 'star' }
    const laid = tieState(saved, patches, new Set(['star']))
    expect(laid).toEqual({ kind: 'laid', patchId: 'star', title: 'The star on the door' })
    expect(effectPlays(laid)).toBe(true)
    const not = tieState(saved, patches, none)
    expect(not.kind).toBe('notLaid')
    expect(effectPlays(not)).toBe(false)
  })

  it('says a patch with no take chosen has nothing to lay', () => {
    const state = tieState({ patch: 'lantern' }, patches, new Set(['lantern']))
    expect(state).toEqual({ kind: 'noTake', patchId: 'lantern', title: 'Broken lantern' })
    expect(effectPlays(state)).toBe(false)
  })

  it('keeps a tie to a patch the game no longer lists, under its saved title', () => {
    const state = tieState({ patch: 'old', patchTitle: 'Old sign' }, patches, none)
    expect(state).toEqual({ kind: 'gone', patchId: 'old', title: 'Old sign' })
    expect(effectPlays(state)).toBe(false)
    expect(tieState({ patch: 'old' }, patches, none)).toMatchObject({
      title: 'old',
    })
  })
})
