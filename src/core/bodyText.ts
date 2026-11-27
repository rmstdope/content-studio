import { z } from 'zod'

/** The part of a JSON Schema, as zod writes it, that a body's description is made from. */
type Node = {
  /** One kind, or several: zod writes a plain value that may be null as both. */
  type?: string | string[]
  description?: string
  default?: unknown
  const?: unknown
  enum?: unknown[]
  anyOf?: Node[]
  oneOf?: Node[]
  properties?: Record<string, Node>
  required?: string[]
  additionalProperties?: Node | boolean
  items?: Node | boolean
  prefixItems?: Node[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
}

/** What a body's schema accepts, as the sender writes it (a field with a default may be left out). */
const nodeOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Node

/** The shapes a node may take: its branches, or itself. */
const branches = (node: Node): Node[] => node.anyOf ?? node.oneOf ?? [node]

/** `a`, `a or b`, `a, b or c`; objects are parted by `or` alone, as their fields have commas. */
const either = (words: string[]) =>
  words.length < 3 || words.some((word) => word.startsWith('{'))
    ? words.join(' or ')
    : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`

/** A number's words with its limits; zod's own limits of a whole number say nothing. */
function numberWords(node: Node): string {
  const { type, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = node
  const real = (limit: number | undefined) =>
    limit === undefined || Math.abs(limit) === Number.MAX_SAFE_INTEGER ? undefined : limit
  const name = type === 'integer' ? 'a whole number' : 'a number'
  const low = real(minimum)
  const high = real(maximum)
  const steps = multipleOf === undefined ? '' : ` in steps of ${multipleOf}`
  if (low !== undefined && high !== undefined) return `${name} ${low} to ${high}${steps}`
  const limits = [
    exclusiveMinimum !== undefined ? `above ${exclusiveMinimum}` : '',
    low !== undefined ? `${low} or more` : '',
    high !== undefined ? `at most ${high}` : '',
    exclusiveMaximum !== undefined ? `below ${exclusiveMaximum}` : '',
  ].filter(Boolean)
  return `${limits.length ? `${name} ${limits.join(', ')}` : name}${steps}`
}

/** The words for one branch of a choice: a bare list of values counts as that many choices. */
const choices = (node: Node) =>
  node.enum && !node.description
    ? node.enum.map((value) => JSON.stringify(value))
    : [typeWords(node)]

/** A value's kind in words, without what is written about it. */
function kindWords(node: Node): string {
  if (node.anyOf || node.oneOf) return either(branches(node).flatMap(choices))
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (node.enum) return either(node.enum.map((value) => JSON.stringify(value)))
  const { type } = node
  if (Array.isArray(type)) return either(type.map((one) => kindWords({ ...node, type: one })))
  switch (type) {
    case 'string':
      return 'text'
    case 'number':
    case 'integer':
      return numberWords(node)
    case 'boolean':
      return 'true or false'
    case 'null':
      return 'null'
    case 'array':
      if (node.prefixItems) return `[${node.prefixItems.map(typeWords).join(', ')}]`
      return `a list of ${typeof node.items === 'object' ? typeWords(node.items) : 'anything'}`
    case 'object': {
      if (!node.properties) {
        const value = node.additionalProperties
        return `an object of ${typeof value === 'object' ? typeWords(value) : 'anything'} by name`
      }
      const fields = Object.entries(node.properties).map(
        ([name, field]) => `${marked(node, name)}: ${typeWords(field)}`,
      )
      return `{ ${fields.join(', ')} }`
    }
    default:
      return 'anything'
  }
}

/** A value in words: its kind, the words written on it and the value used when it is left out. */
function typeWords(node: Node): string {
  const about = node.description ? ` (${node.description})` : ''
  const fallback = node.default === undefined ? '' : `, ${JSON.stringify(node.default)} if left out`
  return `${kindWords(node)}${about}${fallback}`
}

/** A field's name, with `?` when it may be left out. */
const marked = (node: Node, name: string) => (node.required?.includes(name) ? name : `${name}?`)

/**
 * The shape of a body in a few words, from its schema: the field names, `?` on those that may be
 * left out, and `or` between the shapes it may take.
 */
export function bodyShape(schema: z.ZodType): string {
  const node = nodeOf(schema)
  return branches(node)
    .map((branch) => {
      const names = Object.keys(branch.properties ?? {}).map((name) => marked(branch, name))
      return `{ ${names.join(', ')} }`
    })
    .join(' or ')
}

/**
 * What each field of a body takes, from its schema: choices, ranges, what lies inside, and the
 * words written on a field or on the body with `.meta({ description })`.
 */
export function bodyAllowed(schema: z.ZodType): string {
  const node = nodeOf(schema)
  const fields = new Map<string, Set<string>>()
  for (const branch of branches(node)) {
    for (const [name, field] of Object.entries(branch.properties ?? {})) {
      const words = fields.get(name) ?? new Set<string>()
      fields.set(name, words.add(typeWords(field)))
    }
  }
  const line = [...fields].map(([name, words]) => `${name} is ${[...words].join(' or ')}`)
  const about = node.description ? ` ${node.description}` : ''
  return `Allowed: ${line.join('; ')}.${about}`
}

/** A body as the list of an agent's actions describes it: its shape, then what it takes. */
export function bodyText(schema: z.ZodType): string {
  return `${bodyShape(schema)}. ${bodyAllowed(schema)}`
}
