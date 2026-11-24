import { describe, expect, test } from 'bun:test'
import type { Pixels } from './imagePixels'
import {
  CHANGE_BADGE,
  CHANGE_LINE,
  changeOf,
  smallMark,
  smallMarkHead,
  smallMarkText,
} from './imageSmallMark'

const area = (width: number, height: number) => ({ x: 3, y: 4, width, height })

/** A transparent picture with an opaque block of `block` × `block` at its corner. */
function picture(block: number, size = 200, alpha = 255): Pixels {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < block; y++) {
    for (let x = 0; x < block; x++) data.set([9, 9, 9, alpha], (y * size + x) * 4)
  }
  return { width: size, height: size, data }
}

describe('smallMark', () => {
  test('either side under 50 is small', () => {
    expect(smallMark(area(36, 30))).toEqual({ width: 36, height: 30 })
    expect(smallMark(area(49, 80))).toEqual({ width: 49, height: 80 })
    expect(smallMark(area(80, 49))).toEqual({ width: 80, height: 49 })
  })
  test('50 × 50 and larger, and no mark, are not', () => {
    expect(smallMark(area(50, 50))).toBeNull()
    expect(smallMark(area(300, 60))).toBeNull()
    expect(smallMark(null)).toBeNull()
  })
  test('says the agreed words', () => {
    expect(smallMarkHead({ width: 36, height: 30 })).toBe('Too small: 36 × 30.')
    expect(smallMarkText({ width: 36, height: 30 })).toBe(
      'Too small: 36 × 30. Make it at least 50 × 50, or the model may change nothing.',
    )
  })
})

describe('changeOf', () => {
  test('a take that keeps nothing changed nothing', () => {
    expect(changeOf(picture(0))).toBe('nothing')
  })
  test('a few specks changed very little', () => {
    expect(changeOf(picture(10))).toBe('little')
    expect(changeOf(picture(17))).toBe('little')
  })
  test('a faint soft edge alone counts as few', () => {
    expect(changeOf(picture(100, 200, 100))).toBe('little')
  })
  test('a real change is not flagged', () => {
    expect(changeOf(picture(18))).toBeNull()
    expect(changeOf(picture(100))).toBeNull()
  })
  test('has the agreed words', () => {
    expect(CHANGE_BADGE).toEqual({ nothing: 'Changed nothing', little: 'Changed very little' })
    expect(CHANGE_LINE.nothing).toBe('The model left the marked area as it was. Try a bigger mark.')
    expect(CHANGE_LINE.little).toBe('The model changed only a few specks. Try a bigger mark.')
  })
})
