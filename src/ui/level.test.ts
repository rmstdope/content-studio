import { describe, expect, it } from 'bun:test'
import {
  askLevelNotes,
  askLevelTitle,
  behindText,
  couldntSetText,
  hearGain,
  levelCouldntSaveText,
  rewritingText,
  unsetText,
} from './level'

describe('the words of the voice level', () => {
  it('says the saved level and the one to set', () => {
    expect(unsetText(100)).toBe('Not set yet — this voice plays at 100%.')
    expect(askLevelTitle(60)).toBe('Set this voice to 60%?')
    expect(rewritingText(60, 12, 38)).toBe('Setting lines in the game to 60%… 12 of 38')
    expect(levelCouldntSaveText('read-only')).toBe('Couldn’t save the level: read-only')
  })

  it('uses "line" for a count of one', () => {
    expect(askLevelNotes(60, 38)).toEqual([
      'The 38 lines in the game are rewritten at 60%.',
      'New lines are recorded at 60%.',
      'Setting it back to 100% puts them back as they are now.',
    ])
    expect(askLevelNotes(60, 1)[0]).toBe('The 1 line in the game is rewritten at 60%.')
    expect(behindText(3, 100)).toBe('3 lines in the game are still at 100%.')
    expect(behindText(1, 100)).toBe('1 line in the game is still at 100%.')
    expect(couldntSetText(1, 60, 'boom')).toBe('1 line couldn’t be set to 60%: boom')
    expect(couldntSetText(3, 60, 'boom')).toBe('3 lines couldn’t be set to 60%: boom')
  })

  it('hears a file at the slider’s level over the level the file already carries', () => {
    expect(hearGain(60, 60)).toBe(1)
    expect(hearGain(120, 60)).toBe(2)
    expect(hearGain(50, 100)).toBe(0.5)
  })
})
