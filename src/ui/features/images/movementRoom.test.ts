import { describe, expect, it } from 'bun:test'
import { movementRoom, MOVEMENT_MIN_ROOM } from './movementRoom'

describe('the room the window leaves for the Movement stage (as-0234)', () => {
  it('is the window less what is above the stage and what is kept below it', () => {
    expect(movementRoom({ windowHeight: 800, top: 270, below: 40 })).toBe(490)
  })

  it('never goes under 240 px, however short the window', () => {
    expect(MOVEMENT_MIN_ROOM).toBe(240)
    expect(movementRoom({ windowHeight: 400, top: 270, below: 40 })).toBe(240)
  })
})
