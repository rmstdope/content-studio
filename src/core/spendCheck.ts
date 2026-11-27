import { z } from 'zod'

/**
 * What the cost check of a step that may spend answers when the step would not be refused (a
 * `<route>/cost` route, §9): the paid model's price a minute, null when it is free; or, when the
 * step would change nothing, what it would answer. A refusal is answered as the step answers it.
 */
export type SpendCheck = { ok: true; price: string | null } | { ok: true; unchanged: object }

const SpendCheckSchema = z.union([
  z.object({ ok: z.literal(true), price: z.string().nullable() }),
  z.object({ ok: z.literal(true), unchanged: z.record(z.string(), z.unknown()) }),
])

/** The `SpendCheck` a cost route's answer holds; null for anything else, which is not to be trusted. */
export function readSpendCheck(text: string): SpendCheck | null {
  try {
    const read = SpendCheckSchema.safeParse(JSON.parse(text))
    return read.success ? read.data : null
  } catch {
    return null
  }
}
