import { useEffect, useRef } from 'react'
import { startSettings, type EffectType } from '../../../core/motion'
import type { MotionModule } from '../../motionModule'

/** What a picture is shown with: where it is, and the patches laid over it. */
export interface StageLayers {
  src: string
  /** The picture's own size, which the renderer fits its effects to. */
  size: { width: number; height: number }
  patches: { id: string; title: string; src: string }[]
}

/**
 * The picture with the slow zoom, the laid patches and, when the renderer is loaded, a canvas the
 * renderer draws the switched-on effects on. Paused, the zoom and the renderer both hold their
 * frame. Without a loaded renderer it is the still picture, dimmed by its parent.
 */
export function MotionStage({
  layers,
  module,
  effects,
  paused,
  onMissing,
}: {
  layers: StageLayers
  /** The loaded renderer; null leaves the picture still. */
  module: MotionModule | null
  /** The effect types switched on. */
  effects: EffectType[]
  paused: boolean
  /** The picture could not be read. */
  onMissing: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frozen = useRef(paused)
  frozen.current = paused
  const wanted = useRef(effects)
  wanted.current = effects
  const apply = useRef<(instant: boolean) => void>(() => {})

  // One scene per loaded renderer and picture; its loop runs until the stage goes.
  useEffect(() => {
    const element = canvas.current
    if (!module || !element) return
    const scene = module.createScene()
    const context = element.getContext('2d')
    const fit = () => scene.resize(element.clientWidth, element.clientHeight, layers.size)
    fit()
    apply.current = (instant) =>
      scene.setEffects(
        wanted.current.map((type) => ({ kind: type.type, settings: startSettings(type) })),
        instant,
      )
    apply.current(true)
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    watcher?.observe(element)
    let last = 0
    let frame = 0
    const tick = (now: number) => {
      const elapsed = last === 0 ? 0 : Math.min(now - last, 100)
      last = now
      if (!frozen.current) {
        scene.step(elapsed)
        if (context) scene.draw(context)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      watcher?.disconnect()
      apply.current = () => {}
    }
  }, [module, layers.size.width, layers.size.height])

  // What is switched on changes while the scene runs: it fades layers in and out.
  const key = effects.map((type) => type.type).join(',')
  useEffect(() => {
    apply.current(false)
  }, [key])

  return (
    <div className="movement-zoom" data-paused={paused ? 'true' : undefined}>
      <img
        className="movement-pic"
        src={layers.src}
        alt="The image"
        draggable={false}
        onError={onMissing}
      />
      {layers.patches.map((patch) => (
        <img
          key={patch.id}
          className="movement-pic"
          src={patch.src}
          alt={patch.title}
          draggable={false}
        />
      ))}
      {module && <canvas ref={canvas} className="movement-canvas" />}
    </div>
  )
}
