import { describe, expect, it } from 'bun:test'
import {
  allCleanedText,
  askCleanTitle,
  askPutBackTitle,
  cleaningText,
  couldntCleanText,
  couldntPutBackText,
  countText,
  notCleaned,
  puttingBackText,
  stillCleanedText,
} from './cleanLines'

describe('the words about the lines in the game', () => {
  it('say how many lines are not cleaned, as agreed', () => {
    expect(countText(26, 38)).toEqual({
      sentence: '26 of 38 lines in the game aren’t cleaned yet.',
      button: 'Clean 26 lines…',
    })
    expect(countText(1, 38)).toEqual({
      sentence: '1 of 38 lines in the game aren’t cleaned yet.',
      button: 'Clean 1 line…',
    })
  })

  it('say when every line is cleaned', () => {
    expect(allCleanedText(38)).toBe('All 38 lines in the game are cleaned.')
    expect(allCleanedText(1)).toBe('The line in the game is cleaned.')
  })

  it('ask before cleaning and before putting back', () => {
    expect(askCleanTitle(26)).toBe('Clean 26 lines already in the game?')
    expect(askPutBackTitle(38)).toBe('Put back 38 lines as recorded?')
    expect(askCleanTitle(1)).toBe('Clean 1 line already in the game?')
    expect(askPutBackTitle(1)).toBe('Put back 1 line as recorded?')
  })

  it('show progress', () => {
    expect(cleaningText(12, 26)).toBe('Cleaning lines in the game… 12 of 26')
    expect(puttingBackText(20, 38)).toBe('Putting back lines as recorded… 20 of 38')
  })

  it('say what is left after a job that failed, with the reason as given', () => {
    expect(couldntCleanText(3, 'ffmpeg went wrong')).toBe(
      '3 lines couldn’t be cleaned: ffmpeg went wrong',
    )
    expect(couldntPutBackText(3, 'no original')).toBe('3 lines couldn’t be put back: no original')
    expect(stillCleanedText(3)).toEqual({
      sentence: '3 lines in the game are still cleaned.',
      button: 'Put them back',
    })
    expect(stillCleanedText(1).sentence).toBe('1 line in the game is still cleaned.')
    expect(couldntCleanText(1, 'x')).toBe('1 line couldn’t be cleaned: x')
  })

  it('count what is not cleaned', () => {
    expect(notCleaned({ total: 38, cleaned: 12 })).toBe(26)
  })
})
