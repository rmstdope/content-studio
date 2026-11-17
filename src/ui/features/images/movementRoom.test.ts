import { describe, expect, it } from 'bun:test'
import { movementRoom, MOVEMENT_MIN_ROOM, MOVEMENT_TABS_ROOM } from './movementRoom'

describe('the room the window leaves for the Movement stage (as-0234)', () => {
  it('is the window less what is above the stage and what is kept below it', () => {
    expect(movementRoom({ windowHeight: 800, top: 270, below: 40 })).toBe(490)
  })

  it('never goes under 240 px, however short the window', () => {
    expect(MOVEMENT_MIN_ROOM).toBe(240)
    expect(movementRoom({ windowHeight: 400, top: 270, below: 40 })).toBe(240)
  })

  it('when the stage starts too low to fit, is the room below the tabs, as when scrolled to them, up to 480 px (as-l7wb)', () => {
    // 600x800: the sidebar stacks above the page, so the stage starts at 922 and the tabs at 652.
    expect(movementRoom({ windowHeight: 800, top: 922, below: 40, tabs: 652 })).toBe(480)
    // 1280x400: the stage starts at 270, the tabs at 180.
    expect(movementRoom({ windowHeight: 400, top: 270, below: 40, tabs: 180 })).toBe(270)
  })

  it('keeps fitting below where the stage starts while that leaves at least 240 px, tabs or not', () => {
    expect(movementRoom({ windowHeight: 800, top: 270, below: 40, tabs: 200 })).toBe(490)
  })

  it('never goes under 240 px below the tabs either', () => {
    expect(movementRoom({ windowHeight: 300, top: 270, below: 40, tabs: 180 })).toBe(240)
  })

  it('never shrinks as the window grows: no jump where the stage stops fitting below where it starts', () => {
    expect(MOVEMENT_TABS_ROOM).toBe(480)
    let was = 0
    for (let windowHeight = 200; windowHeight <= 1200; windowHeight++) {
      const room = movementRoom({ windowHeight, top: 270, below: 40, tabs: 180 })
      expect(room).toBeGreaterThanOrEqual(was)
      was = room
    }
  })
})
