import { describe, expect, it } from 'bun:test'
import { checkImageRequest } from './imageModels'
import {
  ImageBoardSchema,
  MakeImageTakesBody,
  countedFrom,
  keepAccept,
  madeBeforeAccept,
  rightAfterDrop,
  rowOrder,
  stepRight,
  takeIsEarlier,
  takeSize,
} from './imageTakes'

describe('takeSize', () => {
  it('scales the listed shape so the longer side is 1024, in multiples of 16', () => {
    expect(takeSize({ width: 320, height: 200 })).toEqual({ width: 1024, height: 640 })
    expect(takeSize({ width: 160, height: 200 })).toEqual({ width: 816, height: 1024 })
    expect(takeSize({ width: 100, height: 100 })).toEqual({ width: 1024, height: 1024 })
  })
  it('never makes a side smaller than 16, and is always a size the generator accepts', () => {
    const size = takeSize({ width: 4000, height: 10 })
    expect(size).toEqual({ width: 1024, height: 16 })
    for (const [width, height] of [
      [320, 200],
      [160, 100],
      [1, 999],
      [640, 480],
    ] as const) {
      const s = takeSize({ width, height })
      expect(checkImageRequest({ prompt: 'x', seed: 1, ...s })).toBeNull()
    }
  })
})

describe('a copied take on the board', () => {
  it('keeps where it was copied from, and a take that was not copied has none', () => {
    const take = {
      n: 1,
      seed: 7,
      model: 'flux2-klein-4b',
      width: 1024,
      height: 640,
      madeFrom: { words: 'w', style: 's', width: 320, height: 200 },
    }
    const copied = { image: 'lantern', title: 'Lantern', take: 3 }
    const board = ImageBoardSchema.parse({
      takes: [
        { ...take, copiedFrom: copied },
        { ...take, n: 2 },
      ],
    })
    expect(board.takes[0]!.copiedFrom).toEqual(copied)
    expect(board.takes[1]!.copiedFrom).toBeUndefined()
    expect(
      ImageBoardSchema.safeParse({ takes: [{ ...take, copiedFrom: { image: 'x' } }] }).success,
    ).toBe(false)
  })
})

describe('the board', () => {
  it('reads a board of takes and refuses a take without a number', () => {
    const take = {
      n: 1,
      seed: 7,
      model: 'flux2-klein-4b',
      width: 1024,
      height: 640,
      madeFrom: { words: 'w', style: 's', width: 320, height: 200 },
    }
    const board = ImageBoardSchema.parse({ next: 2, takes: [take] })
    expect(board.takes[0]!.seen).toBe(false)
    expect(ImageBoardSchema.safeParse({ next: 2, takes: [{ ...take, n: 0 }] }).success).toBe(false)
  })
})

describe('what a take counts as made from', () => {
  const madeFrom = { words: 'a low inn', style: 's', width: 320, height: 200 }
  const take = (over: object = {}) =>
    ImageBoardSchema.parse({
      takes: [{ n: 1, seed: 7, model: 'm', width: 1024, height: 640, madeFrom, ...over }],
    }).takes[0]!
  const accepted = { words: 'a high inn', style: 'oil' }
  const later = { words: 'a red inn', style: 'ink' }
  const entry = { ...madeFrom, ...later, take: 1, seed: 7, model: 'm' }

  it('is its own without an entry or an accept', () => {
    expect(countedFrom(take(), undefined)).toEqual(madeFrom)
  })

  it('is what the board remembers it was accepted for, once it has left the game', () => {
    expect(countedFrom(take({ accepted }), undefined)).toEqual({ ...madeFrom, ...accepted })
  })

  it('is what the lock’s entry of it holds while it is in the game, whatever the board remembers', () => {
    expect(countedFrom(take({ accepted }), entry)).toEqual({ ...madeFrom, ...later })
    expect(countedFrom(take({ accepted }), { ...entry, ...madeFrom })).toEqual(madeFrom)
  })

  it('counts an entry that records no seed or model', () => {
    const old = { ...entry, seed: undefined, model: undefined }
    expect(countedFrom(take(), old)).toEqual({ ...madeFrom, ...later })
  })

  it('ignores an entry that is not of that take', () => {
    for (const not of [
      { take: 2 },
      { take: undefined },
      { seed: 8 },
      { model: 'n' },
      { width: 160 },
      { height: 100 },
    ]) {
      expect(countedFrom(take({ accepted }), { ...entry, ...not })).toEqual({
        ...madeFrom,
        ...accepted,
      })
    }
  })

  it('counts a copy’s entry whatever size it records, and keeps the take’s own size', () => {
    const copy = take({ copiedFrom: { image: 'x', title: 'X', take: 3 } })
    expect(countedFrom(copy, { ...entry, width: 160 })).toEqual({ ...madeFrom, ...later })
    expect(countedFrom(copy, { ...entry, seed: 8 })).toEqual(madeFrom)
  })

  it('has a reader for its own, before any accept', () => {
    expect(madeBeforeAccept(take({ accepted }))).toEqual(madeFrom)
  })
})

describe('earlier words', () => {
  const madeFrom = { words: 'a low inn', style: 's', width: 320, height: 200 }
  const take = (over: object = {}) =>
    ImageBoardSchema.parse({
      takes: [{ n: 1, seed: 7, model: 'm', width: 1024, height: 640, madeFrom, ...over }],
    }).takes[0]!
  const entry = { ...madeFrom, take: 1, seed: 7, model: 'm' }
  const accepted = { words: 'a high inn', style: 's' }

  it('marks a take only when the words differ', () => {
    expect(takeIsEarlier(take(), undefined, 'a low inn')).toBe(false)
    expect(takeIsEarlier(take(), undefined, 'a high inn')).toBe(true)
  })

  it('does not mark the take in the game once the lock counts it from the words now', () => {
    expect(takeIsEarlier(take(), { ...entry, ...accepted }, 'a high inn')).toBe(false)
  })

  it('does not mark a take that left the game with an accept for the words now', () => {
    expect(takeIsEarlier(take({ accepted }), undefined, 'a high inn')).toBe(false)
    const other = { ...entry, take: 2 }
    expect(takeIsEarlier(take({ accepted }), other, 'a high inn')).toBe(false)
  })

  it('marks it again when the words changed after the accept', () => {
    expect(takeIsEarlier(take(), { ...entry, ...accepted }, 'a red inn')).toBe(true)
    expect(takeIsEarlier(take({ accepted }), undefined, 'a red inn')).toBe(true)
  })

  it('marks it again after Undo accept, whatever the board still remembers', () => {
    expect(takeIsEarlier(take({ accepted }), entry, 'a high inn')).toBe(true)
  })

  it('never marks words put back to those the take was made from', () => {
    expect(takeIsEarlier(take(), { ...entry, ...accepted }, 'a low inn')).toBe(false)
    expect(takeIsEarlier(take({ accepted }), undefined, 'a low inn')).toBe(false)
  })

  it('never marks a copy', () => {
    const copiedFrom = { image: 'x', title: 'X', take: 1 }
    expect(takeIsEarlier(take({ copiedFrom }), undefined, 'a high inn')).toBe(false)
  })

  it('does not count a lock entry that is not of that take', () => {
    for (const not of [{ seed: 8 }, { model: 'n' }, { width: 160 }, { height: 100 }]) {
      expect(takeIsEarlier(take(), { ...entry, ...accepted, ...not }, 'a high inn')).toBe(true)
    }
  })
})

describe('the take on the right', () => {
  const strip = [1, 3, 4, 6]
  it('steps one take along the strip and stops at its ends', () => {
    expect(stepRight(strip, 3, 1)).toBe(4)
    expect(stepRight(strip, 3, -1)).toBe(1)
    expect(stepRight(strip, 6, 1)).toBe(6)
    expect(stepRight(strip, 1, -1)).toBe(1)
  })
  it('starts at the newest take when none is on the right', () => {
    expect(stepRight(strip, null, -1)).toBe(6)
    expect(stepRight([], null, 1)).toBeNull()
  })
  it('after a drop, the next take comes right, or the previous one for the last', () => {
    expect(rightAfterDrop(strip, 3)).toBe(4)
    expect(rightAfterDrop(strip, 6)).toBe(4)
    expect(rightAfterDrop([5], 5)).toBeNull()
  })
})

describe('the request to make takes', () => {
  it('asks for 1 to 10 takes, or the retry of one', () => {
    expect(MakeImageTakesBody.safeParse({ count: 2 }).success).toBe(true)
    expect(MakeImageTakesBody.safeParse({ count: 11 }).success).toBe(false)
    expect(MakeImageTakesBody.safeParse({ count: 0 }).success).toBe(false)
    expect(MakeImageTakesBody.safeParse({ retry: 7 }).success).toBe(true)
    expect(MakeImageTakesBody.safeParse({ count: 2, retry: 7 }).success).toBe(false)
  })
})

describe('asking for takes', () => {
  it('takes 1 to 10 at once', () => {
    for (const count of [1, 4, 10]) {
      expect(MakeImageTakesBody.safeParse({ count }).success).toBe(true)
    }
    for (const count of [0, 11, 2.5]) {
      expect(MakeImageTakesBody.safeParse({ count }).success).toBe(false)
    }
  })
})

describe('an accept kept on its take', () => {
  const style = (look: string) => JSON.stringify([look, 'text', null])
  const madeFrom = { words: 'a low inn', style: style('pixel art'), width: 320, height: 200 }
  const board = (take: object = {}) =>
    ImageBoardSchema.parse({
      next: 2,
      takes: [{ n: 1, seed: 7, model: 'm', width: 1024, height: 640, madeFrom, ...take }],
    })
  const entry = { ...madeFrom, take: 1, seed: 7, model: 'm' }
  const accepted = { words: 'a high inn', style: style('oil paint') }

  it('remembers the words and style the game counts the take as made from, and counts it from them', () => {
    const it = board()
    expect(keepAccept(it, { ...entry, ...accepted })).toBe(true)
    expect(it.takes[0]!.accepted).toEqual(accepted)
    expect(countedFrom(it.takes[0]!, undefined)).toEqual({ ...madeFrom, ...accepted })
    expect(ImageBoardSchema.parse(it).takes[0]!.accepted).toEqual(accepted)
    expect(keepAccept(it, { ...entry, ...accepted })).toBe(false)
  })

  it('forgets it when the game counts the take from its own again', () => {
    const it = board({ accepted })
    expect(keepAccept(it, entry)).toBe(true)
    expect(it.takes[0]!.accepted).toBeUndefined()
    expect(countedFrom(it.takes[0]!, undefined)).toEqual(madeFrom)
    expect(keepAccept(it, entry)).toBe(false)
  })

  it('takes a style key written with its palette as the same style', () => {
    const old = JSON.stringify(['pixel art', 'text', ['#000000'], null])
    const it = board({ madeFrom: { ...madeFrom, style: old } })
    expect(keepAccept(it, entry)).toBe(false)
  })

  it('leaves the board alone for no entry, or one that is not of that take', () => {
    for (const other of [
      undefined,
      { ...entry, ...accepted, take: 2 },
      { ...entry, ...accepted, take: undefined },
      { ...entry, ...accepted, seed: 8 },
      { ...entry, ...accepted, model: 'n' },
      { ...entry, ...accepted, width: 160 },
      { ...entry, ...accepted, height: 100 },
    ]) {
      const it = board()
      expect(keepAccept(it, other)).toBe(false)
      expect(it.takes[0]!.accepted).toBeUndefined()
    }
  })

  it('keeps nothing for a copy, which was made from no words of this image’s', () => {
    const it = board({ copiedFrom: { image: 'hall', title: 'Hall', take: 1 } })
    expect(keepAccept(it, { ...entry, ...accepted })).toBe(false)
    expect(it.takes[0]!.accepted).toBeUndefined()
  })
})

describe('rowOrder', () => {
  const making = (n: number) => ({ n, state: 'waiting' as const, elapsed: 0, expected: 60 })
  const failed = (n: number) => ({ n, message: 'It broke.' })

  it('stands the takes made, being made and failed in number order', () => {
    const order = rowOrder([{ n: 1 }, { n: 6 }], [making(7), making(4)], [failed(5), failed(2)])
    expect(order.map((e) => [e.n, e.kind])).toEqual([
      [1, 'take'],
      [2, 'failed'],
      [4, 'making'],
      [5, 'failed'],
      [6, 'take'],
      [7, 'making'],
    ])
  })

  it('carries each entry as it was', () => {
    const broke = failed(3)
    expect(rowOrder([], [], [broke])).toEqual([{ kind: 'failed', n: 3, failed: broke }])
  })
})
