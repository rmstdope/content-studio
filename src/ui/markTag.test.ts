import { describe, expect, test } from 'bun:test'
import { tagSide, TAG_WIDTH } from './markTag'

const picture = { width: 1000, height: 500 }

describe('tagSide', () => {
  test('sits at the right of the mark while the tag fits inside the picture', () => {
    expect(tagSide({ x: 100, y: 100, width: 36, height: 30 }, picture, 800)).toBe('right')
  })
  test('flips to the left when there is no room at the right', () => {
    expect(tagSide({ x: 960, y: 100, width: 40, height: 30 }, picture, 800)).toBe('left')
  })
  test('counts room in screen pixels, not take pixels', () => {
    // 250 screen px are left at 1000 take px of width on a 1000 px stage; not on a 500 px one.
    const area = { x: 700, y: 0, width: 40, height: 40 }
    expect(tagSide(area, picture, 1000)).toBe('right')
    expect(tagSide(area, picture, 500)).toBe('left')
    expect(TAG_WIDTH).toBe(250)
  })
})
