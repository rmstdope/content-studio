import { describe, expect, it } from 'bun:test'
import { drawingBar, foldedDrawing, foldedPlacing, newShapeBar, SPOT_WORDS } from './motionText'

describe('the drawing words', () => {
  it('say Esc stops the shape on the tab, for an empty spot and a new shape', () => {
    expect(drawingBar('Rain', 'empty').rest).toContain('Esc stops this shape.')
    expect(newShapeBar('Rain').rest).toContain('Esc stops this shape.')
  })

  it('leave the Esc sentence out in full screen', () => {
    expect(drawingBar('Rain', 'empty', { esc: false })).toEqual({
      lead: 'Drawing your own spot for Rain.',
      rest: ' Click to place each corner; click the first corner to close the shape.',
    })
    expect(newShapeBar('Rain', { esc: false })).toEqual({
      lead: 'New shape for Rain.',
      rest: ' Click to place each corner; click the first corner to close the shape.',
    })
  })

  it('name the folded strips and the button that stops a shape', () => {
    expect(foldedDrawing('Rain')).toBe('Drawing Rain')
    expect(foldedPlacing('Rain')).toBe('New shape for Rain')
    expect(SPOT_WORDS.stopShape).toBe('Stop this shape')
  })
})
