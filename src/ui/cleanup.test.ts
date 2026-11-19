import { describe, expect, it } from 'bun:test'
import { clock, firstEntry, hearEntries, loopingText } from './cleanup'
import type { RecordedLine } from './inGame'

const line = (key: string, text: string): RecordedLine => ({
  id: `act1/${key}`,
  part: 'act1',
  title: 'Act I',
  text,
  cue: '',
  status: 'ok',
  file: `${key}.mp3`,
})
const clip = (l: RecordedLine) => `/clip/${l.file}`

describe('hearEntries', () => {
  it('lists the take first, then each recorded line as its part and words', () => {
    const entries = hearEntries(
      'abc',
      '/take',
      [line('a', 'You climbed.'), line('b', 'Welcome.')],
      clip,
    )
    expect(entries.map((e) => e.label)).toEqual([
      'The take (the audition phrase)',
      'Act I · “You climbed.”',
      'Act I · “Welcome.”',
    ])
    expect(entries[1]).toMatchObject({
      source: { part: 'act1', file: 'a.mp3' },
      url: '/clip/a.mp3',
    })
    expect(entries[0]).toMatchObject({ source: { take: 'abc' }, url: '/take' })
  })

  it('opens on the first recorded line, and on the take when there is none', () => {
    expect(firstEntry(hearEntries('abc', '/take', [line('a', 'x')], clip)).id).toBe('act1/a')
    expect(firstEntry(hearEntries('abc', '/take', [], clip)).id).toBe('take')
  })

  it('says when the take is not made yet', () => {
    expect(hearEntries(null, null, [], clip)[0]?.missing).toBe(true)
  })
})

describe('the clock', () => {
  it('shows minutes and seconds', () => {
    expect(clock(7.9)).toBe('0:07')
    expect(clock(65)).toBe('1:05')
    expect(loopingText(3.2, 7.4)).toBe('0:03 / 0:07 · looping')
  })
})
