import { describe, expect, it } from 'bun:test'
import {
  GAME_ZOOM,
  percentText,
  secondsText,
  zoomDiffers,
  zoomLook,
  zoomRangeNotes,
  zoomValues,
} from './zoom'

describe('zoomValues', () => {
  it('is on at the game’s own 16 s and 3% when nothing is saved', () => {
    expect(zoomValues(undefined)).toEqual({ on: true, seconds: 16, percent: 3 })
    expect(GAME_ZOOM).toEqual({ seconds: 16, percent: 3 })
  })

  it('holds a saved value to the game’s range and keeps the rest', () => {
    expect(zoomValues({ on: false, seconds: 90, percent: 0.1 })).toEqual({
      on: false,
      seconds: 60,
      percent: 0.5,
    })
  })
})

describe('zoomDiffers', () => {
  it('is false for nothing saved and for exactly the game’s own', () => {
    expect(zoomDiffers(undefined)).toBe(false)
    expect(zoomDiffers({ on: true, seconds: 16, percent: 3 })).toBe(false)
  })

  it('is true when off or when either value is another', () => {
    expect(zoomDiffers({ on: false, seconds: 16, percent: 3 })).toBe(true)
    expect(zoomDiffers({ on: true, seconds: 24, percent: 3 })).toBe(true)
    expect(zoomDiffers({ on: true, seconds: 16, percent: 5 })).toBe(true)
  })
})

describe('zoomRangeNotes', () => {
  it('says nothing for values in range or none saved', () => {
    expect(zoomRangeNotes(undefined)).toEqual([])
    expect(zoomRangeNotes({ on: true, seconds: 60, percent: 0.5 })).toEqual([])
  })

  it('says what was saved and what the game plays, for each value out of range', () => {
    expect(zoomRangeNotes({ on: true, seconds: 90, percent: 12 })).toEqual([
      'Each way was saved as 90 s; the game goes up to 60, so it plays 60.',
      'How far was saved as 12%; the game goes up to 10, so it plays 10.',
    ])
    expect(zoomRangeNotes({ on: true, seconds: 2, percent: 0 })).toEqual([
      'Each way was saved as 2 s; the game goes down to 4, so it plays 4.',
      'How far was saved as 0%; the game goes down to 0.5, so it plays 0.5.',
    ])
  })
})

describe('zoomLook', () => {
  it('is null while the zoom is off', () => {
    expect(zoomLook({ on: false, seconds: 16, percent: 3 })).toBeNull()
  })

  it('keeps the old drift at 3% and scales it with how far', () => {
    expect(zoomLook({ on: true, seconds: 16, percent: 3 })).toEqual({
      seconds: 16,
      scale: 1.03,
      x: -0.5,
      y: -0.3,
    })
    const five = zoomLook({ on: true, seconds: 24, percent: 5 })!
    expect(five.seconds).toBe(24)
    expect(five.scale).toBe(1.05)
    expect(five.x).toBeCloseTo(-0.8333, 3)
  })
})

describe('the words', () => {
  it('writes values as a person reads them', () => {
    expect(secondsText(24)).toBe('24 s')
    expect(percentText(5)).toBe('5%')
    expect(percentText(2.5)).toBe('2.5%')
  })
})
