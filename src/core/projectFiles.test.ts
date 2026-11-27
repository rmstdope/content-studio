/**
 * Holds `docs/project-files.md`, which promises every field of the game files, to the schemas the
 * studio reads and writes those files with. A new field fails here until the file's section shows
 * it in an example and names it in its text. A new file needs its own line in `FILES`.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { TimedWord } from './align'
import { CleanedSchema, originalsDir } from './cleanedLines'
import { EffectEntrySchema, EffectOverridesSchema } from './effects'
import { EffectLockSchema, EffectManifestSchema } from './effectTakes'
import {
  ImageEditsSchema,
  ImageLockSchema,
  ImageSchema,
  type AreaFractions,
  type GameEffect,
  type ImageManifestEntry,
  type ManifestPatch,
} from './images'
import { BriefsSchema, TrackSchema } from './music'
import { MusicLockSchema, MusicManifestSchema } from './musicChoose'
import { ProjectSchema } from './project'
import {
  CastSchema,
  LineSchema,
  LockSchema,
  NarrationEditsSchema,
  type WrittenClip,
} from './resources'
import { SceneLockSchema } from './sceneLoudness'
import { SceneDeclarationSchema, SceneMixSchema } from './scenes'

const DOC = readFileSync(join(import.meta.dir, '../../docs/project-files.md'), 'utf8')

/** One file: its schema, and the headings of its text. Its examples are under the last of them. */
interface Documented {
  schema: z.ZodType
  headings: string[]
}

const list = (item: z.ZodType, heading: string): Documented => ({
  schema: z.array(item),
  headings: ["The game's lists", heading],
})
const edits = (schema: z.ZodType, heading: string): Documented => ({
  schema,
  headings: ['Edits', heading],
})
const lock = (schema: z.ZodType, heading: string): Documented => ({
  schema,
  headings: ['Locks', heading],
})
const manifest = (schema: z.ZodType, heading: string): Documented => ({
  schema,
  headings: ['What the game plays', heading],
})

/*
 * The narration and images manifests are read loosely (the game's own fields are kept), so what
 * the studio writes in them is given by types in `core`. These schemas stand for those types.
 */
const word = z.object({ word: z.string(), start: z.number(), end: z.number() })
const clip = z.object({
  file: z.string(),
  speaker: z.string(),
  duration: z.number(),
  words: z.array(word),
})
const patch = z.object({ file: z.string(), width: z.number(), height: z.number() })
const mark = z.object({ x: z.number(), y: z.number() })
const area = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  mark: mark.optional(),
})
const corner = z.tuple([z.number(), z.number()])
const effect = z.object({
  kind: z.string(),
  settings: z.record(z.string(), z.number()),
  patch: z.string().optional(),
  unlessPatch: z.string().optional(),
  spot: z.array(z.array(corner)).optional(),
  mark: corner.optional(),
})
const zoom = z.object({ seconds: z.number(), percent: z.number() })
const image = z.object({
  file: z.string(),
  width: z.number(),
  height: z.number(),
  patches: z.record(z.string(), patch).optional(),
  areas: z.record(z.string(), area).optional(),
  effects: z.array(effect).optional(),
  zoom: zoom.nullable().optional(),
})

/** The fields of a type its schema leaves out: `never` when it has them all. */
type Left<Type, Schema extends z.ZodType> = Exclude<keyof Type, keyof z.output<Schema>>
// A field added to one of the types fails `bun run typecheck` here until its schema has it, and
// then the tests below until the reference has it.
const nothingLeftOut: [
  | Left<WrittenClip, typeof clip>
  | Left<TimedWord, typeof word>
  | Left<ImageManifestEntry, typeof image>
  | Left<ManifestPatch, typeof patch>
  | Left<AreaFractions, typeof area>
  | Left<NonNullable<AreaFractions['mark']>, typeof mark>
  | Left<GameEffect, typeof effect>
  | Left<NonNullable<ImageManifestEntry['zoom']>, typeof zoom>,
] extends [never]
  ? true
  : never = true

const FILES: Record<string, Documented> = {
  'the project file': {
    schema: ProjectSchema,
    headings: [
      'The top level',
      'The sections',
      '`narration`',
      '`music`',
      '`images`',
      '`effects`',
      '`scenes`',
      'The project file: `content-studio.json`',
    ],
  },
  'the dialog list': list(LineSchema, 'A line'),
  'the music lists': list(TrackSchema, 'A track'),
  'the images list': list(ImageSchema, 'An image'),
  'the effects list': list(EffectEntrySchema, 'A sound effect'),
  'the scenes list': list(SceneDeclarationSchema, 'A scene'),
  'the cast': edits(CastSchema, '`narration/cast.json`'),
  'the narration edits': edits(NarrationEditsSchema, '`narration/<part>.edits.json`'),
  'the music edits': edits(BriefsSchema, '`music/edits.json`'),
  'the images edits': edits(ImageEditsSchema, '`images/edits.json`'),
  'the effects edits': edits(EffectOverridesSchema, '`effects/edits.json`'),
  'the narration lock': lock(LockSchema, 'The narration lock'),
  'the music lock': lock(MusicLockSchema, 'The music lock'),
  'the images lock': lock(ImageLockSchema, 'The images lock'),
  'the effects lock': lock(EffectLockSchema, 'The effects lock'),
  'the scenes locks': lock(SceneLockSchema, 'The scenes locks'),
  'the cleaned record': {
    schema: CleanedSchema,
    headings: ['`narration/<part>.cleaned.json`'],
  },
  'the narration manifest': manifest(z.record(z.string(), clip), 'The narration manifest'),
  'the images manifest': manifest(z.record(z.string(), image), 'The images manifest'),
  'the music manifest': manifest(MusicManifestSchema, 'The music manifest'),
  'the effects manifest': manifest(EffectManifestSchema, 'The effects manifest'),
  'the mix': {
    schema: z.object({ scenes: z.record(z.string(), SceneMixSchema) }),
    headings: ["A part's mix"],
  },
}

/** The text right under a heading, up to the next heading of any level. */
function textUnder(heading: string): string {
  const lines = DOC.split('\n')
  let fenced = false
  const headingAt = lines.map((line) => {
    if (line.startsWith('```')) fenced = !fenced
    return fenced ? null : (/^#{1,6} (.*)$/.exec(line)?.[1] ?? null)
  })
  const start = headingAt.indexOf(heading)
  if (start === -1) throw new Error(`docs/project-files.md has no heading "${heading}"`)
  const end = headingAt.findIndex((h, at) => at > start && h !== null)
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

const FENCE = /^```(\w*)\n([\s\S]*?)^```$/gm

function examplesOf({ headings }: Documented): unknown[] {
  const text = textUnder(headings.at(-1)!)
  return [...text.matchAll(FENCE)]
    .filter(([, language]) => language === 'json')
    .map(([, , body]) => JSON.parse(body!) as unknown)
}

interface Node {
  type?: string
  properties?: Record<string, Node>
  additionalProperties?: Node | boolean
  items?: Node
  anyOf?: Node[]
  oneOf?: Node[]
  allOf?: Node[]
}

/**
 * The paths of the fields a schema names (`speakers.*.voice`, `[].id`): all of them, or with a
 * `value`, those the value holds. `*` is any key of a table.
 */
function fieldsOf(node: Node, path: string, value?: { is: unknown }): string[] {
  const out: string[] = []
  const walk = (child: Node, at: string, is: unknown) =>
    out.push(...fieldsOf(child, at, value && { is }))
  for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
    walk(branch, path, value?.is)
  }
  const object =
    value && typeof value.is === 'object' && value.is !== null && !Array.isArray(value.is)
      ? (value.is as Record<string, unknown>)
      : undefined
  const named = node.properties ?? {}
  for (const [key, child] of Object.entries(named)) {
    if (value && !(object && Object.hasOwn(object, key))) continue
    const at = path ? `${path}.${key}` : key
    out.push(at)
    walk(child, at, object?.[key])
  }
  const others = node.additionalProperties
  // A loose object's `{}` names nothing; a table's values have a shape.
  if (typeof others === 'object' && Object.keys(others).length) {
    const at = path ? `${path}.*` : '*'
    if (!value) walk(others, at, undefined)
    for (const [key, is] of Object.entries(object ?? {})) {
      if (!Object.hasOwn(named, key)) walk(others, at, is)
    }
  }
  if (node.items) {
    const at = `${path}[]`
    if (!value) walk(node.items, at, undefined)
    else if (Array.isArray(value.is)) for (const is of value.is) walk(node.items, at, is)
  }
  return out
}

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Node

describe('docs/project-files.md', () => {
  for (const [name, file] of Object.entries(FILES)) {
    describe(name, () => {
      const schema = jsonSchema(file.schema)

      it('has examples the studio can read', () => {
        const examples = examplesOf(file)
        expect(examples.length).toBeGreaterThan(0)
        for (const example of examples) {
          expect(file.schema.safeParse(example).error?.issues ?? []).toEqual([])
        }
      })

      it('shows every field in an example', () => {
        const shown = new Set(
          examplesOf(file).flatMap((example) => fieldsOf(schema, '', { is: example })),
        )
        const missing = [...new Set(fieldsOf(schema, ''))].filter((field) => !shown.has(field))
        expect(missing).toEqual([])
      })

      it('names every field in its text', () => {
        const prose = file.headings.map((h) => textUnder(h).replace(FENCE, '')).join('\n')
        const spans = [...prose.matchAll(/`([^`\n]+)`/g)].map(([, span]) => span!)
        const names = new Set(
          fieldsOf(schema, '').map((field) => field.split('.').at(-1)!.replaceAll('[]', '')),
        )
        names.delete('*')
        const missing = [...names].filter((field) => {
          const word = new RegExp(`(?<![\\w$-])${field.replace('$', '\\$')}(?![\\w-])`)
          return !spans.some((span) => word.test(span))
        })
        expect(missing).toEqual([])
      })
    })
  }

  it('has a schema for every field of the typed manifests', () => {
    expect(nothingLeftOut).toBe(true)
  })

  it('lists the cleaned record and the originals in the studio folder', () => {
    const layout = textUnder('The studio folder: `content-studio/`')
    const originals = originalsDir({ languages: ['en'] }, 'act1', 'en')
    expect(originals).toBe('content-studio/narration/originals/act1')
    expect(layout).toContain('originals/')
    expect(layout).toContain('act1.cleaned.json')
  })
})
