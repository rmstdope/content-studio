import { z } from 'zod'

/** One setting an effect takes, as the project's motion renderer reports it. */
const EffectSettingSchema = z
  .object({
    /** The key of the setting. */
    id: z.string().min(1),
    /** What the studio calls it. */
    title: z.string().min(1),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite(),
    /** The value the game plays when nothing is chosen. */
    default: z.number().finite(),
  })
  .refine((s) => s.min <= s.default && s.default <= s.max, {
    error: 'its starting value must lie between its smallest and largest',
  })

/** One setting an effect takes. */
export type EffectSetting = z.infer<typeof EffectSettingSchema>

/** One kind of movement the project's renderer can draw. */
const EffectTypeSchema = z.object({
  /** The key of the type. */
  type: z.string().min(1),
  /** What the studio calls it. */
  title: z.string().min(1),
  /** Whether it lives on a spot drawn on the picture rather than floating over the whole of it. */
  spot: z.boolean(),
  settings: z.array(EffectSettingSchema),
})

/** One kind of movement the project's renderer can draw. */
export type EffectType = z.infer<typeof EffectTypeSchema>

/** The `EFFECT_TYPES` a renderer exports: every effect it has, in its own order, each type once. */
const EffectTypesSchema = z.array(EffectTypeSchema).superRefine((types, context) => {
  const seen = new Set<string>()
  for (const { type } of types) {
    if (seen.has(type)) context.addIssue({ code: 'custom', message: `"${type}" is listed twice` })
    seen.add(type)
  }
})

/**
 * Reads what a motion renderer exports as `EFFECT_TYPES`: its effects with their settings, or what
 * is wrong with it, written to be shown as the renderer's own error.
 */
export function parseEffectTypes(
  value: unknown,
): { ok: true; types: EffectType[] } | { ok: false; message: string } {
  const parsed = EffectTypesSchema.safeParse(value)
  if (parsed.success) return { ok: true, types: parsed.data }
  const issue = parsed.error.issues[0]!
  const [index, , , key] = issue.path
  const at = typeof index === 'number' ? ` at ${typeName(value, index)}` : ''
  const setting =
    issue.path[1] === 'settings' && typeof issue.path[2] === 'number'
      ? ` setting ${settingId(value, index, issue.path[2])}`
      : ''
  const field = key === undefined ? '' : ` (${String(key)})`
  const what = Array.isArray(value) ? issue.message : 'must be a list of effects'
  return { ok: false, message: `EFFECT_TYPES${at}${setting}${field}: ${what}` }
}

/** The name of the effect at `index` of whatever was exported, for a message. */
function typeName(value: unknown, index: number): string {
  const found = Array.isArray(value) ? (value[index] as { type?: unknown } | undefined) : undefined
  return typeof found?.type === 'string' ? `"${found.type}"` : `#${index}`
}

/** The id of the setting at `at` of the effect at `index`, for a message. */
function settingId(value: unknown, index: unknown, at: number): string {
  const effect = Array.isArray(value) && typeof index === 'number' ? value[index] : undefined
  const found = (effect as { settings?: { id?: unknown }[] } | undefined)?.settings?.[at]
  return typeof found?.id === 'string' ? `"${found.id}"` : `#${at}`
}

/** What the server answers when asked for the project's motion renderer. */
export type MotionRendererAnswer =
  | { named: false }
  | { named: true; ok: true; code: string }
  | { named: true; ok: false; file: string; message: string }

/** A number as a person reads it: no trailing zeros, no floating-point tail. */
export function numberText(n: number): string {
  return String(Number(n.toFixed(4)))
}

/** A setting as the Effects group lists it: its name, its range and its starting value. */
export function settingLine(setting: EffectSetting): string {
  return `${setting.title} ${numberText(setting.min)}–${numberText(setting.max)} (${numberText(setting.default)})`
}

/** All of an effect's settings on one line, joined with " · ". */
export function settingsLine(type: EffectType): string {
  return type.settings.map(settingLine).join(' · ')
}

/** The settings of an effect at their starting values, by setting id. */
export function startSettings(type: EffectType): Record<string, number> {
  return Object.fromEntries(type.settings.map((s) => [s.id, s.default]))
}
