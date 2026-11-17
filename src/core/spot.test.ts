import { describe, expect, it } from 'bun:test'
import {
  addShape,
  clampUnit,
  dropShape,
  MARK_STEP,
  middleOf,
  moveMark,
  nudgeMark,
  moveCorner,
  pointInShape,
  removeCorner,
  replaceShape,
  shapeAt,
} from './spot'

const tri: [number, number][] = [
  [0.1, 0.1],
  [0.5, 0.1],
  [0.3, 0.6],
]
const sq: [number, number][] = [
  [0.6, 0.6],
  [0.9, 0.6],
  [0.9, 0.9],
  [0.6, 0.9],
]

describe('a spot’s geometry', () => {
  it('holds a number to the picture and to four decimals', () => {
    expect(clampUnit(-0.2)).toBe(0)
    expect(clampUnit(1.4)).toBe(1)
    expect(clampUnit(0.123456)).toBe(0.1235)
  })

  it('knows what is inside a shape', () => {
    expect(pointInShape(tri, 0.3, 0.3)).toBe(true)
    expect(pointInShape(tri, 0.8, 0.3)).toBe(false)
    expect(pointInShape(sq, 0.75, 0.75)).toBe(true)
  })

  it('finds the shape at a point, the last drawn first', () => {
    const over: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    expect(shapeAt([tri, over], 0.3, 0.3)).toBe(1)
    expect(shapeAt([tri, sq], 0.3, 0.3)).toBe(0)
    expect(shapeAt([tri], 0.9, 0.9)).toBe(null)
  })

  it('moves a corner, keeping it on the picture', () => {
    expect(moveCorner(tri, 2, 0.35, 0.7)[2]).toEqual([0.35, 0.7])
    expect(moveCorner(tri, 0, -1, 2)[0]).toEqual([0, 1])
    expect(tri[0]).toEqual([0.1, 0.1])
  })

  it('takes a corner out, but never leaves fewer than three', () => {
    expect(removeCorner(sq, 1)).toEqual([sq[0]!, sq[2]!, sq[3]!])
    expect(removeCorner(tri, 1)).toBe(null)
  })

  it('adds, replaces and drops shapes; no shape left is no spot', () => {
    expect(addShape(undefined, tri)).toEqual([tri])
    expect(addShape([tri], sq)).toEqual([tri, sq])
    const three = removeCorner(sq, 0)!
    expect(replaceShape([tri, sq], 0, three)).toEqual([three, sq])
    expect(dropShape([tri, sq], 0)).toEqual([sq])
    expect(dropShape([tri], 0)).toBeUndefined()
  })
})

describe('the light mark', () => {
  it('starts at the middle of the box around every corner of every shape', () => {
    expect(middleOf([tri, sq])).toEqual([0.5, 0.5])
    expect(middleOf([tri])).toEqual([0.3, 0.35])
  })
  it('is held to the picture and to four decimals', () => {
    expect(moveMark(-0.2, 1.4)).toEqual([0, 1])
    expect(moveMark(0.123456, 0.5)).toEqual([0.1235, 0.5])
  })
  it('moves by a step for an arrow key, stops at the edges, and ignores other keys', () => {
    expect(nudgeMark([0.5, 0.5], 'ArrowRight')).toEqual([0.5 + MARK_STEP, 0.5])
    expect(nudgeMark([0.5, 0.5], 'ArrowUp')).toEqual([0.5, 0.5 - MARK_STEP])
    expect(nudgeMark([1, 0], 'ArrowRight')).toEqual([1, 0])
    expect(nudgeMark([0.5, 0.5], 'a')).toBeNull()
  })
})
