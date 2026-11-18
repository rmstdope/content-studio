import { describe, expect, test } from 'bun:test'
import { off, tipOnly, tipPlace, tipReaction, type TipFacts } from './off'

describe('off', () => {
  test('a control with no reason against it gets nothing added', () => {
    expect(off()).toEqual({})
    expect(off(false, null, undefined, '')).toEqual({})
  })

  test('the first reason wins, so they are written in the order to deal with them', () => {
    const props = off(false, 'Setup first.', 'Wait for the takes.')
    expect(props['data-why']).toBe('Setup first.')
    expect(props['aria-description']).toBe('Setup first.')
    expect(props['aria-disabled']).toBe(true)
  })

  test('when the first clears, the next one shows', () => {
    expect(off(false, 'Wait for the takes.')['data-why']).toBe('Wait for the takes.')
  })
})

describe('tipOnly', () => {
  test('carries the reason for the tip but leaves the control on', () => {
    const props = tipOnly(false, 'No dialog yet', 'later')
    expect(props['data-why']).toBe('No dialog yet')
    expect(props['aria-description']).toBe('No dialog yet')
    expect('aria-disabled' in props).toBe(false)
  })

  test('with no reason it adds nothing', () => {
    expect(tipOnly(false, '')).toEqual({})
  })
})

describe('tipPlace', () => {
  const win = { width: 800, height: 600 }
  const tip = { width: 200, height: 40 }
  const target = (left: number, top: number) => ({ left, top, width: 80, height: 30 })

  test('opens above the control, centred on it', () => {
    expect(tipPlace(target(300, 300), tip, win, 6)).toEqual({ left: 240, top: 254, side: 'above' })
  })

  test('opens below when there is no room above', () => {
    expect(tipPlace(target(300, 20), tip, win, 6)).toEqual({ left: 240, top: 56, side: 'below' })
  })

  test('moves inward near a window edge', () => {
    expect(tipPlace(target(4, 300), tip, win, 6).left).toBe(8)
    expect(tipPlace(target(740, 300), tip, win, 6).left).toBe(592)
  })

  test('stays inside a window narrower than the tip', () => {
    expect(tipPlace(target(10, 300), tip, { width: 150, height: 600 }, 6).left).toBe(8)
  })
})

describe('tipReaction', () => {
  const base: TipFacts = {
    moved: false,
    onTip: false,
    over: 'none',
    shown: false,
    held: false,
    lingering: false,
  }
  const react = (facts: Partial<TipFacts>) => tipReaction({ ...base, ...facts })

  test('the tip being read is kept, whatever it covers', () => {
    expect(react({ onTip: true, over: 'other', shown: true })).toBe('keep')
    expect(react({ onTip: true, moved: true, shown: true })).toBe('keep')
  })

  test('arriving over a control shows its tip, held by focus or not', () => {
    expect(react({ over: 'other' })).toBe('show')
    expect(react({ over: 'shown', shown: true })).toBe('show')
    expect(react({ over: 'other', shown: true, held: true })).toBe('show')
  })

  test('a move over the shown control keeps its tip and never reopens one closed with Esc', () => {
    expect(react({ moved: true, over: 'shown', shown: true, lingering: true })).toBe('keep')
    expect(react({ moved: true, over: 'other' })).toBe('nothing')
  })

  test('a move onto another control shows it unless keyboard focus holds the tip', () => {
    expect(react({ moved: true, over: 'other', shown: true })).toBe('show')
    expect(react({ moved: true, over: 'other', shown: true, held: true })).toBe('nothing')
  })

  test('leaving every control lets the tip go soon, unless keyboard focus holds it', () => {
    expect(react({ shown: true })).toBe('hide-soon')
    expect(react({ shown: true, held: true })).toBe('nothing')
    expect(react({ shown: true, held: true, moved: true })).toBe('nothing')
  })

  test('a move off the controls starts the linger but never puts it off again', () => {
    expect(react({ moved: true, shown: true })).toBe('hide-soon')
    expect(react({ moved: true, shown: true, lingering: true })).toBe('nothing')
    expect(react({ shown: true, lingering: true })).toBe('hide-soon')
  })

  test('with no tip up and nothing under the pointer, nothing happens', () => {
    expect(react({})).toBe('nothing')
    expect(react({ moved: true })).toBe('nothing')
  })
})
