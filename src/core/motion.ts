import { z } from 'zod'
import { SpotShapeSchema, type SpotShape } from './images'

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
  /**
   * Where the game places the effect by default: its shapes, `"whole"` (the whole picture),
   * `"fixed"` (it cannot be placed anywhere else), or absent (the game doesn't say).
   */
  placement: z
    .union([z.literal('whole'), z.literal('fixed'), z.array(SpotShapeSchema).min(1)])
    .optional(),
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

/** A setting's value as the sliders show it: a plain number with two decimals. */
export function valueText(n: number): string {
  return n.toFixed(2)
}

/** A value held to the setting's range. */
export function clampSetting(setting: EffectSetting, value: number): number {
  return Math.min(setting.max, Math.max(setting.min, value))
}

/**
 * What an effect plays and its sliders show: each setting's saved value held to the renderer's
 * range now, or its starting value where none is saved.
 */
export function effectValues(
  type: EffectType,
  saved: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  return Object.fromEntries(
    type.settings.map((s) => [s.id, clampSetting(s, saved?.[s.id] ?? s.default)]),
  )
}

/** Whether any of an effect's settings is not at the renderer's starting value (when Reset shows). */
export function effectDiffers(
  type: EffectType,
  saved: Readonly<Record<string, number>> | undefined,
): boolean {
  const values = effectValues(type, saved)
  return type.settings.some((s) => values[s.id] !== s.default)
}

/** The sentence for a saved value the renderer's range no longer holds; null when it is in range or nothing is saved. */
export function rangeNote(setting: EffectSetting, saved: number | undefined): string | null {
  if (saved === undefined || (saved >= setting.min && saved <= setting.max)) return null
  const high = saved > setting.max
  const limit = numberText(high ? setting.max : setting.min)
  return `${setting.title} was saved as ${valueText(saved)}; the renderer now goes ${high ? 'up' : 'down'} to ${limit}, so the game plays ${limit}.`
}

/** A patch of the image as the tie rules see it. */
export interface TiePatch {
  id: string
  title: string
  /** It has a chosen take to lay. */
  hasTake: boolean
}

/**
 * Where an effect stands with its tie: untied, or tied (to show while the patch is laid, or with
 * `without`, while it is not) to a patch that is laid, not laid, has no take, or was dropped by the game.
 */
export type TieState =
  | { kind: 'always' }
  | {
      kind: 'laid' | 'notLaid' | 'noTake' | 'gone'
      without?: true
      patchId: string
      title: string
    }

/** An effect's tie as the preview must treat it, given the game's patches and those laid now. */
export function tieState(
  saved: {
    patch?: string | undefined
    unlessPatch?: string | undefined
    patchTitle?: string | undefined
  },
  patches: readonly TiePatch[],
  laid: ReadonlySet<string>,
): TieState {
  const id = saved.patch ?? saved.unlessPatch
  if (id === undefined) return { kind: 'always' }
  const without = saved.patch === undefined ? { without: true as const } : {}
  const patch = patches.find((p) => p.id === id)
  if (!patch) return { kind: 'gone', ...without, patchId: id, title: saved.patchTitle ?? id }
  const base = { ...without, patchId: id, title: patch.title }
  if (!patch.hasTake) return { kind: 'noTake', ...base }
  return { kind: laid.has(id) ? 'laid' : 'notLaid', ...base }
}

/** Whether the picture runs the effect now. */
export function effectPlays(state: TieState): boolean {
  if (state.kind === 'always') return true
  if (state.kind === 'gone') return false
  if (state.without) return state.kind !== 'laid'
  return state.kind === 'laid'
}

/** What an effect's renderer says of where the game places it. */
export type Placement = EffectType['placement']

/** The game's shapes for an effect: its own, the whole picture's edge for `"whole"`, none otherwise. */
export function gameShapes(placement: Placement): SpotShape[] {
  if (placement === 'whole') {
    return [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ]
  }
  return Array.isArray(placement) ? placement : []
}

/** Whose shape an effect plays in, as its row on the Movement tab tells it. */
export type SpotView =
  | { who: 'game'; shape: 'shapes' | 'whole' | 'unknown' }
  | { who: 'own'; count: number; marked: boolean }
  | { who: 'fixed'; kept: boolean }

/** Whose shape the effect plays in, from what the renderer says and what is saved for it. */
export function spotView(
  placement: Placement,
  saved: { spot?: readonly SpotShape[] | undefined; mark?: unknown } | undefined,
): SpotView {
  const count = saved?.spot?.length ?? 0
  if (placement === 'fixed') return { who: 'fixed', kept: count > 0 }
  if (count > 0) return { who: 'own', count, marked: saved?.mark !== undefined }
  if (placement === 'whole') return { who: 'game', shape: 'whole' }
  return { who: 'game', shape: Array.isArray(placement) ? 'shapes' : 'unknown' }
}
