import { useEffect, useRef } from 'react'
import type { MotionModule, MotionScene } from '../../motionModule'

/** What a picture is shown with: where it is, and the patches laid over it. */
export interface StageLayers {
  src: string
  /** The picture's own size, which the renderer fits its effects to. */
  size: { width: number; height: number }
  patches: { id: string; title: string; src: string }[]
}

/** One effect the stage plays: the renderer's kind and the settings it is asked for. */
export interface StageEffect {
  kind: string
  settings: Record<string, number>
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
  running,
  onMissing,
}: {
  layers: StageLayers
  /** The loaded renderer; null leaves the picture still. */
  module: MotionModule | null
  /** The effects in the game, with the settings they play at; the picture follows them live. */
  effects: StageEffect[]
  paused: boolean
  /** Whether the stage is on show (its tab is open); a hidden stage runs no frames. */
  running: boolean
  /** The picture could not be read. */
  onMissing: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const picture = useRef<HTMLImageElement>(null)
  const scene = useRef<MotionScene | null>(null)
  const wanted = useRef(effects)
  wanted.current = effects

  /** Gives the canvas one pixel per screen pixel (twice at most) and tells the scene its size in screen pixels. */
  const fit = useRef(() => {})
  /** Hands the scene the picture it may redraw, once the picture has loaded. */
  const feed = useRef(() => {})

  // One scene per loaded renderer and picture size.
  useEffect(() => {
    const element = canvas.current
    if (!module || !element) return
    const made = module.createScene()
    scene.current = made
    const paint = () => {
      const context = element.getContext('2d')
      if (!context || element.clientWidth === 0) return
      const ratio = element.width / element.clientWidth
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      made.draw(context)
    }
    fit.current = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1)
      const width = Math.round(element.clientWidth * ratio)
      const height = Math.round(element.clientHeight * ratio)
      // Setting the size clears the canvas, so only when it changed.
      if (element.width !== width) element.width = width
      if (element.height !== height) element.height = height
      made.resize(element.clientWidth, element.clientHeight, layers.size)
      // The new size cleared the canvas: paint it again, or a paused picture loses its effects.
      paint()
    }
    feed.current = () => {
      const image = picture.current
      if (image?.complete && image.naturalWidth > 0) {
        made.setSource?.({ image, width: image.naturalWidth, height: image.naturalHeight })
      }
    }
    fit.current()
    feed.current()
    made.setEffects(wanted.current, true)
    const watcher =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit.current()) : null
    watcher?.observe(element)
    return () => {
      watcher?.disconnect()
      scene.current = null
      fit.current = () => {}
      feed.current = () => {}
    }
  }, [module, layers.size.width, layers.size.height])

  // What is switched on, or how it is tuned, changes while the scene runs: a change of the set
  // fades layers in and out; a change of values only is applied at once.
  const kinds = effects.map((effect) => effect.kind).join(',')
  const values = JSON.stringify(effects)
  const first = useRef(true)
  const lastKinds = useRef(kinds)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const sameSet = lastKinds.current === kinds
    lastKinds.current = kinds
    scene.current?.setEffects(wanted.current, sameSet)
  }, [values, kinds])

  // The frame loop runs only while the stage is on show and not paused.
  const going = running && !paused
  useEffect(() => {
    const element = canvas.current
    if (!module || !element || !going) return
    const context = element.getContext('2d')
    let last = 0
    let frame = 0
    const tick = (now: number) => {
      const elapsed = last === 0 ? 0 : Math.min(now - last, 100)
      last = now
      const made = scene.current
      if (made) {
        made.step(elapsed)
        if (context) {
          const ratio = element.clientWidth > 0 ? element.width / element.clientWidth : 1
          context.setTransform(ratio, 0, 0, ratio, 0, 0)
          made.draw(context)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [module, going])

  return (
    <div className="movement-zoom" data-paused={paused ? 'true' : undefined}>
      <img
        ref={picture}
        className="movement-pic"
        src={layers.src}
        alt="The image"
        draggable={false}
        onLoad={() => feed.current()}
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
