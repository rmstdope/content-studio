import { describe, expect, it } from 'bun:test'
import { clampFloat, FLOAT_KEY, readFloat, writeFloat } from './floatPlace'

const screen = { width: 1000, height: 600 }
const size = { width: 300, height: 200 }

describe('clampFloat', () => {
  it('leaves a place that is inside', () => {
    expect(clampFloat({ left: 100, top: 50 }, size, screen)).toEqual({ left: 100, top: 50 })
  })
  it('pulls the panel in from every edge', () => {
    expect(clampFloat({ left: -40, top: -9 }, size, screen)).toEqual({ left: 0, top: 0 })
    expect(clampFloat({ left: 900, top: 500 }, size, screen)).toEqual({ left: 700, top: 400 })
  })
  it('keeps a panel bigger than the screen at the top left', () => {
    expect(clampFloat({ left: 50, top: 50 }, { width: 1200, height: 900 }, screen)).toEqual({
      left: 0,
      top: 0,
    })
  })
})

describe('the remembered place', () => {
  const store = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [[FLOAT_KEY, initial]])
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
  }
  it('is written and read back', () => {
    const s = store()
    writeFloat({ left: 12, top: 34 }, s)
    expect(readFloat(s)).toEqual({ left: 12, top: 34 })
  })
  it('is nothing when absent, malformed or blocked', () => {
    expect(readFloat(store())).toBeNull()
    expect(readFloat(store('nope'))).toBeNull()
    expect(readFloat(store('{"left":"a","top":1}'))).toBeNull()
    expect(
      readFloat({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toBeNull()
  })
  it('ignores a refused write', () => {
    expect(() =>
      writeFloat(
        { left: 1, top: 2 },
        {
          setItem: () => {
            throw new Error('full')
          },
        },
      ),
    ).not.toThrow()
  })
})
