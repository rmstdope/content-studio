import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { bodyAllowed, bodyShape, bodyText } from './bodyText'

describe('the shape of a body', () => {
  it('names the fields, marking those that may be left out', () => {
    const body = z.object({
      file: z.string(),
      undo: z.boolean().optional(),
      stage: z.enum(['draft', 'final']).default('draft'),
    })
    expect(bodyShape(body)).toBe('{ file, undo?, stage? }')
  })

  it('joins the shapes a body may take', () => {
    const body = z.union([
      z.object({ count: z.number(), model: z.string().optional() }),
      z.object({ retry: z.number() }),
    ])
    expect(bodyShape(body)).toBe('{ count, model? } or { retry }')
  })
})

describe('what a body takes', () => {
  const field = (schema: z.ZodType) => bodyAllowed(z.object({ x: schema }))

  it.each<[string, z.ZodType, string]>([
    ['text', z.string().max(10), 'text'],
    ['a choice', z.enum(['a', 'b', 'c']), '"a", "b" or "c"'],
    ['true or false', z.boolean(), 'true or false'],
    ['text or null', z.string().nullable(), 'text or null'],
    ['a range or null', z.number().int().min(1).max(2).nullable(), 'a whole number 1 to 2 or null'],
    ['a value or null', z.enum(['a']).nullable(), '"a" or null'],
    ['a range', z.number().min(10).max(200), 'a number 10 to 200'],
    ['a lower limit', z.number().nonnegative(), 'a number 0 or more'],
    ['a whole number above', z.number().int().positive(), 'a whole number above 0'],
    ['a capped number', z.number().positive().max(5), 'a number above 0, at most 5'],
    ['a whole number', z.number().int(), 'a whole number'],
    ['a list', z.array(z.string()), 'a list of text'],
    ['pairs', z.array(z.tuple([z.string(), z.number()])), 'a list of [text, a number]'],
    ['named values', z.record(z.string(), z.number()), 'an object of a number by name'],
    ['only one value', z.literal(true), 'true'],
  ])('says %s', (_, schema, words) => {
    expect(field(schema)).toBe(`Allowed: x is ${words}.`)
  })

  it('spells out an object inside, and the shapes it may take', () => {
    const play = z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('loop') }),
      z.object({ mode: z.literal('once'), after: z.number().min(0).optional() }),
    ])
    expect(field(z.object({ play }))).toBe(
      'Allowed: x is { play: { mode: "loop" } or { mode: "once", after?: a number 0 or more } }.',
    )
  })

  it('parts objects that are a choice with “or” alone, so their fields do not run together', () => {
    const one = (mode: string) => z.object({ mode: z.literal(mode) })
    expect(field(z.union([one('a'), one('b'), one('c')]))).toBe(
      'Allowed: x is { mode: "a" } or { mode: "b" } or { mode: "c" }.',
    )
  })

  it('adds the words written on a field, and on a field inside', () => {
    const level = z.number().meta({ description: '1 as made' })
    const body = z.object({
      level,
      inner: z.object({ level }).meta({ description: 'again' }),
    })
    expect(bodyAllowed(body)).toBe(
      'Allowed: level is a number (1 as made); inner is { level: a number (1 as made) } (again).',
    )
  })

  it('names the value used when a field is left out', () => {
    const body = z.object({ stage: z.enum(['draft', 'final']).default('draft') })
    expect(bodyAllowed(body)).toBe('Allowed: stage is "draft" or "final", "draft" if left out.')
  })

  it('names each field of every shape once, and ends with the body’s own words', () => {
    const body = z
      .union([
        z.object({ n: z.number(), a: z.string() }),
        z.object({ n: z.number(), b: z.string() }),
      ])
      .meta({ description: 'One at a time.' })
    expect(bodyAllowed(body)).toBe('Allowed: n is a number; a is text; b is text. One at a time.')
  })

  it('puts the shape and what it takes together', () => {
    expect(bodyText(z.object({ x: z.string() }))).toBe('{ x }. Allowed: x is text.')
  })
})
