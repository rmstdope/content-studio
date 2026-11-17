import { parseEffectTypes, type EffectType } from '../core/motion'

/** One slow-running picture's moving layer: the part of the renderer's scene the studio drives. */
export interface MotionScene {
  /** Optional: the picture itself, for effects that redraw it (ripples); called once it has loaded. */
  setSource?(source: { image: CanvasImageSource; width: number; height: number } | null): void
  /** The canvas is `width` × `height` pixels, showing a picture of `picture` size trimmed to fill it. */
  resize(width: number, height: number, picture: { width: number; height: number }): void
  /**
   * What applies now; with `instant`, a new layer is run ahead and starts at full strength. An
   * effect with a `spot` is placed and held to its shapes (fractions of the picture) by the renderer.
   */
  setEffects(
    specs: readonly {
      kind: string
      settings?: Record<string, number>
      spot?: [number, number][][]
    }[],
    instant: boolean,
  ): void
  /** Move on `ms` milliseconds. */
  step(ms: number): void
  /** Draw what there is onto `ctx` (clearing it first). */
  draw(ctx: CanvasRenderingContext2D): void
  /** Whether nothing is left to run or fade. */
  isEmpty(): boolean
}

/** The project's motion renderer, loaded: what it can do and how to make a scene. */
export interface MotionModule {
  types: EffectType[]
  createScene: () => MotionScene
}

/**
 * Loads the renderer's bundled code in the page and checks it has what the studio drives: the
 * effects it reports and a scene maker. What goes wrong is said as text, never thrown.
 */
export async function loadMotionModule(code: string): Promise<MotionModule | { error: string }> {
  let loaded: Record<string, unknown>
  try {
    const bytes = new TextEncoder().encode(code)
    let binary = ''
    for (let at = 0; at < bytes.length; at += 8192) {
      binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
    }
    const url = `data:text/javascript;base64,${btoa(binary)}`
    loaded = (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  if (!('EFFECT_TYPES' in loaded)) return { error: 'the module does not export EFFECT_TYPES' }
  if (typeof loaded.createMotionScene !== 'function') {
    return { error: 'the module does not export createMotionScene' }
  }
  const effects = parseEffectTypes(loaded.EFFECT_TYPES)
  if (!effects.ok) return { error: effects.message }
  const make = loaded.createMotionScene as () => MotionScene
  return { types: effects.types, createScene: () => make() }
}
