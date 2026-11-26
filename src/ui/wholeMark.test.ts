import { describe, expect, test } from 'bun:test'
import { isWholeKey, wholeKeyText } from './wholeMark'

const press = (
  over: Partial<Parameters<typeof isWholeKey>[0]> = {},
): Parameters<typeof isWholeKey>[0] => ({
  key: 'a',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

describe('the key that marks the whole picture', () => {
  test('is ⌘A on a Mac, an iPad too', () => {
    for (const platform of ['MacIntel', 'iPad', 'iPhone']) {
      expect(wholeKeyText(platform)).toBe('⌘A')
      expect(isWholeKey(press({ metaKey: true }), platform)).toBe(true)
      expect(isWholeKey(press({ ctrlKey: true }), platform)).toBe(false)
    }
  })

  test('is Ctrl+A off a Mac', () => {
    for (const platform of ['Win32', 'Linux x86_64', '']) {
      expect(wholeKeyText(platform)).toBe('Ctrl+A')
      expect(isWholeKey(press({ ctrlKey: true }), platform)).toBe(true)
      expect(isWholeKey(press({ metaKey: true }), platform)).toBe(false)
    }
  })

  test('takes a capital A (Caps Lock), and nothing with Shift or Alt, nor A alone', () => {
    expect(isWholeKey(press({ key: 'A', metaKey: true }), 'MacIntel')).toBe(true)
    expect(isWholeKey(press({ metaKey: true, shiftKey: true }), 'MacIntel')).toBe(false)
    expect(isWholeKey(press({ metaKey: true, altKey: true }), 'MacIntel')).toBe(false)
    expect(isWholeKey(press({ metaKey: true, ctrlKey: true }), 'MacIntel')).toBe(false)
    expect(isWholeKey(press(), 'MacIntel')).toBe(false)
    expect(isWholeKey(press({ key: 's', metaKey: true }), 'MacIntel')).toBe(false)
  })
})
