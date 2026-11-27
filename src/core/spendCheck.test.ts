import { describe, expect, it } from 'bun:test'
import { readSpendCheck } from './spendCheck'

describe('reading what a cost check answered', () => {
  it('reads a price, no price, and a step that would change nothing', () => {
    expect(readSpendCheck('{"ok":true,"price":"$0.15 a minute"}')).toEqual({
      ok: true,
      price: '$0.15 a minute',
    })
    expect(readSpendCheck('{"ok":true,"price":null}')).toEqual({ ok: true, price: null })
    expect(readSpendCheck('{"ok":true,"unchanged":{"takes":0}}')).toEqual({
      ok: true,
      unchanged: { takes: 0 },
    })
  })

  it('tells nothing from any other answer, so it is asked about and never let through', () => {
    for (const text of [
      '',
      'not JSON',
      'null',
      '[]',
      '{}',
      '{"ok":true}',
      '{"ok":false,"price":null}',
      '{"ok":true,"price":3}',
      '{"ok":true,"unchanged":null}',
      '{"price":null}',
    ]) {
      expect(readSpendCheck(text)).toBeNull()
    }
  })
})
