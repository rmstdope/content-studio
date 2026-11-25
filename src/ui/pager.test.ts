import { describe, expect, test } from 'bun:test'
import { pagerFor, pagerStep, shiftPagerStep, type ShiftPagerPress } from './pager'

const plain = (key: string, over: Partial<Parameters<typeof pagerStep>[0]> = {}) =>
  pagerStep({ key, modifier: false, target: { tagName: 'DIV', closest: () => null }, ...over })

describe('pagerStep', () => {
  test('left and right step back and forward', () => {
    expect(plain('ArrowLeft')).toBe(-1)
    expect(plain('ArrowRight')).toBe(1)
  })
  test('other keys and modified keys do nothing', () => {
    expect(plain('ArrowUp')).toBeNull()
    expect(plain('ArrowLeft', { modifier: true })).toBeNull()
  })
  test('typing in a field is the field’s', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(plain('ArrowLeft', { target: { tagName, closest: () => null } })).toBeNull()
    expect(
      plain('ArrowLeft', {
        target: { tagName: 'DIV', isContentEditable: true, closest: () => null },
      }),
    ).toBeNull()
  })
  test('a control that uses the arrows keeps them', () => {
    expect(plain('ArrowRight', { target: { tagName: 'BUTTON', closest: () => ({}) } })).toBeNull()
  })
})

const shifted = (key: string, over: Partial<ShiftPagerPress> = {}) =>
  shiftPagerStep({
    key,
    shift: true,
    modifier: false,
    covered: false,
    target: { tagName: 'DIV', closest: () => null },
    ...over,
  })
/** A target inside whatever one of `selectors` names. */
const within = (name: string) => ({
  tagName: 'BUTTON',
  closest: (selectors: string) => (selectors.split(', ').includes(name) ? {} : null),
})

describe('shiftPagerStep', () => {
  test('Shift with left and right steps back and forward', () => {
    expect(shifted('ArrowLeft')).toBe(-1)
    expect(shifted('ArrowRight')).toBe(1)
  })
  test('plain, otherwise modified and other keys are not its', () => {
    expect(shifted('ArrowLeft', { shift: false })).toBeNull()
    expect(shifted('ArrowLeft', { modifier: true })).toBeNull()
    expect(shifted('ArrowUp')).toBeNull()
  })
  test('a control that uses the arrows pages all the same', () => {
    for (const name of [
      '[data-strip]',
      '.scene-list',
      '[role="menu"]',
      '[role="listbox"]',
      '[role="slider"]',
      '[role="tablist"]',
      '[role="radiogroup"]',
    ])
      expect(shifted('ArrowRight', { target: within(name) })).toBe(1)
  })
  test('a text field keeps it', () => {
    for (const target of [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'number' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ])
      expect(shifted('ArrowRight', { target: { ...target, closest: () => null } })).toBeNull()
  })
  test('a box, a radio button and a range slider page', () => {
    for (const type of ['checkbox', 'radio', 'range'])
      expect(
        shifted('ArrowRight', { target: { tagName: 'INPUT', type, closest: () => null } }),
      ).toBe(1)
  })
  test('a dialog and a control that keeps Shift with the arrows keep it', () => {
    for (const name of [
      '.modal-back',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[data-keeps-shift-arrows]',
    ])
      expect(shifted('ArrowRight', { target: within(name) })).toBeNull()
  })
  test('nothing pages while the top arrows are covered', () => {
    expect(shifted('ArrowRight', { covered: true })).toBeNull()
  })
})

describe('pagerFor', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const step = (i: { id: string }) => ({ name: i.id.toUpperCase(), href: `#/${i.id}` })
  test('names the place and the neighbours', () => {
    expect(pagerFor(items, 'b', step)).toEqual({
      place: { position: 2, count: 3 },
      previous: { name: 'A', href: '#/a' },
      next: { name: 'C', href: '#/c' },
    })
    expect(pagerFor(items, 'a', step)?.previous).toBeNull()
  })
  test('is null for an item the list lacks', () => {
    expect(pagerFor(items, 'z', step)).toBeNull()
  })
})
