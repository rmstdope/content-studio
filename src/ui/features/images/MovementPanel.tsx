import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageRow, SavedEffects, SpotShape } from '../../../core/images'
import {
  effectValues,
  startSettings,
  type EffectSetting,
  type EffectType,
} from '../../../core/motion'
import { addShape, dropShape } from '../../../core/spot'
import { useImagePatches, useMotionRenderer, useSetImageEffects } from '../../api'
import {
  MOVEMENT_WORDS,
  SAVED_FOR_MS,
  SPOT_WORDS,
  SAVING_AFTER_MS,
  deleteAsk,
  drawingBar,
  newShapeBar,
  takeCaption,
} from '../../motionText'
import {
  MotionControls,
  type MovementPatch,
  type SaveStatus,
  type SpotControls,
} from './MotionControls'
import { MotionStage, type StageEffect } from './MotionStage'
import { SpotOverlay } from './SpotOverlay'
import { useJobOpen } from './ImageJobTabs'
import { typingIn } from './useWorkbenchKeys'

/** Whether this computer asks for reduced motion. */
function asksForReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A spot being drawn: which effect, the corners of the shape being placed, the picked shape, and whether a delete is being asked. */
interface Drawing {
  type: string
  placing: [number, number][] | null
  picked: number | null
  confirm: boolean
}

/**
 * An image's Movement tab: the chosen take drawn moving by the project's own motion renderer, with
 * the patches to switch on for looking and the renderer's effects to put in the game and tune,
 * in the page and full screen. The effects are saved as you go (and go to the game); the patch
 * switches go back off when the tab is left, and it always starts playing.
 * `onEffectsOn` tells the page how many of the renderer's effects are in the game, once it is known.
 */
export function MovementPanel({
  row,
  onGoToMake,
  onEffectsOn,
}: {
  row: ImageRow
  onGoToMake: () => void
  onEffectsOn?: (count: number | null) => void
}) {
  const open = useJobOpen()
  const { state: motion, retry } = useMotionRenderer(open)
  const patchView = useImagePatches(row.id).data
  const [patchesOn, setPatchesOn] = useState<ReadonlySet<string>>(new Set())
  // The image's effects as set here: they are what the picture plays and what is saved.
  const [effects, setEffects] = useState<SavedEffects>(() => row.effects)
  const latest = useRef(effects)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const save = useSetImageEffects(row.id)
  const saves = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState(false)
  const [folded, setFolded] = useState(false)
  const [missing, setMissing] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const drawingRef = useRef<Drawing | null>(null)
  const [peek, setPeek] = useState<string | null>(null)
  const [leftOut, setLeftOut] = useState<string | null>(null)
  const [failedSpot, setFailedSpot] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const fullButton = useRef<HTMLButtonElement>(null)
  const reduced = asksForReducedMotion()

  // Leaving the tab puts everything back: all switches off, playing.
  useEffect(() => {
    if (open) return
    setPatchesOn(new Set())
    setPaused(false)
    setFolded(false)
    if (document.fullscreenElement && document.fullscreenElement === wrap.current) {
      void document.exitFullscreen()
    }
  }, [open])

  const src =
    row.chosenTake !== null
      ? `/api/images/${encodeURIComponent(row.id)}/takes/${row.chosenTake}`
      : row.gameFile?.exists
        ? `/api/images/${encodeURIComponent(row.id)}/current`
        : null
  const picture = src !== null && missing !== src ? src : null
  // Playing: the renderer is loaded and there is a picture to move; only then do the keys act.
  const running = motion.status === 'ready' && picture !== null

  const patches: MovementPatch[] | null =
    patchView && 'patches' in patchView
      ? row.patches.map((patch) => {
          const take = patchView.patches.find((p) => p.id === patch.id)?.takes.find((t) => t.chosen)
          return {
            id: patch.id,
            title: patch.title,
            src: take
              ? `/api/images/${encodeURIComponent(row.id)}/patches/${encodeURIComponent(patch.id)}/takes/${take.n}`
              : null,
          }
        })
      : null

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  /** Saves the effects as they are now; the latest save's outcome is the one shown. */
  const persist = useCallback(
    (spot = false) => {
      const mine = ++saves.current
      timers.current.forEach(clearTimeout)
      timers.current = [
        setTimeout(() => {
          if (saves.current === mine) setStatus('saving')
        }, SAVING_AFTER_MS),
      ]
      const done = (ok: boolean) => {
        if (saves.current !== mine) return
        timers.current.forEach(clearTimeout)
        setFailedSpot(spot)
        setStatus(ok ? 'saved' : 'failed')
        if (ok) timers.current = [setTimeout(() => setStatus('idle'), SAVED_FOR_MS)]
      }
      save.mutate(latest.current, {
        onSuccess: (answer) => done(answer.ok),
        onError: () => done(false),
      })
    },
    [save],
  )

  /** Sets the effects here (the picture follows at once); saving is `persist`'s. */
  const set = (next: SavedEffects) => {
    latest.current = next
    setEffects(next)
  }
  const onEffect = (type: EffectType, on: boolean) => {
    if (!on && drawingRef.current?.type === type.type) finish(false)
    const was = latest.current[type.type]
    // Every setting goes to the game: those the renderer has added since take their starting value.
    set({
      ...latest.current,
      [type.type]: {
        ...was,
        title: type.title,
        on,
        settings: { ...startSettings(type), ...was?.settings },
      },
    })
    persist()
  }
  const onSetting = (type: EffectType, setting: EffectSetting, value: number) => {
    const was = latest.current[type.type]
    set({
      ...latest.current,
      [type.type]: {
        ...was,
        title: type.title,
        on: was?.on ?? true,
        settings: { ...effectValues(type, was?.settings), [setting.id]: value },
      },
    })
  }
  const onReset = (type: EffectType) => {
    set({
      ...latest.current,
      [type.type]: {
        ...latest.current[type.type],
        title: type.title,
        on: latest.current[type.type]?.on ?? true,
        settings: startSettings(type),
      },
    })
    persist()
  }
  const onClear = (type: EffectType) => {
    setLeftOut(null)
    const was = latest.current[type.type]
    if (!was) return
    const { spot: _gone, ...rest } = was
    set({ ...latest.current, [type.type]: rest })
    persist(true)
  }
  const onRemove = (type: string) => {
    const { [type]: _gone, ...rest } = latest.current
    set(rest)
    persist()
  }

  /** Sets the drawing state (kept in a ref too, for the handlers that outlive a render). */
  const draw = (next: Drawing | null) => {
    drawingRef.current = next
    setDrawing(next)
  }
  /** Leaves drawing: a shape not closed is left out, said so; focus goes back to the effect's link when asked. */
  const finish = useCallback((refocus: boolean) => {
    const now = drawingRef.current
    if (!now) return
    if (now.placing && now.placing.length > 0) setLeftOut(now.type)
    drawingRef.current = null
    setDrawing(null)
    if (refocus) {
      setTimeout(
        () =>
          document
            .querySelector<HTMLElement>(`.movement-side [data-spot-link="${now.type}"]`)
            ?.focus(),
        0,
      )
    }
  }, [])
  /** Sets an effect's spot (none: the whole picture) in the effects; saving is the caller's. */
  const setSpot = (type: string, spot: SpotShape[] | undefined) => {
    setLeftOut((was) => (was === type ? null : was))
    const was = latest.current[type]
    if (!was) return
    const { spot: _old, ...rest } = was
    set({ ...latest.current, [type]: spot ? { ...rest, spot } : rest })
  }
  // Leaving the tab finishes drawing.
  useEffect(() => {
    if (!open) finish(false)
  }, [open, finish])
  // Esc stops the shape being placed, or otherwise leaves drawing.
  useEffect(() => {
    if (!drawing) return
    const listen = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const now = drawingRef.current
      if (!now) return
      event.preventDefault()
      if (now.confirm) draw({ ...now, confirm: false })
      else if (now.placing) draw({ ...now, placing: null })
      else finish(true)
    }
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [drawing === null, finish]) // eslint-disable-line react-hooks/exhaustive-deps
  // The bar's first button takes focus whenever the bar changes what it asks.
  const barMode =
    drawing === null ? null : drawing.confirm ? 'ask' : drawing.placing ? 'place' : 'draw'
  useEffect(() => {
    if (barMode) bar.current?.querySelector('button')?.focus()
  }, [barMode, drawing?.type])
  const spotOf = (type: string): SpotShape[] => latest.current[type]?.spot ?? []
  const onDraw = (type: EffectType) => {
    setLeftOut(null)
    draw({
      type: type.type,
      placing: spotOf(type.type).length === 0 ? [] : null,
      picked: null,
      confirm: false,
    })
  }

  const toggle = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }

  const openFull = useCallback(() => {
    finish(false)
    void wrap.current?.requestFullscreen?.()?.catch(() => {})
  }, [finish])
  const closeFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
  }, [])

  // The browser's own Esc leaves full screen too: follow it, and bring focus back to the button.
  useEffect(() => {
    const follow = () => {
      const now = document.fullscreenElement !== null && document.fullscreenElement === wrap.current
      setFull((was) => {
        if (was && !now) setTimeout(() => fullButton.current?.focus(), 0)
        return now
      })
    }
    document.addEventListener('fullscreenchange', follow)
    return () => document.removeEventListener('fullscreenchange', follow)
  }, [])

  // Space pauses and plays, F opens full screen, while this tab is open and nobody is typing.
  useEffect(() => {
    if (!open || !running) return
    const listen = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typingIn(event.target)) return
      // On a button or a switch Space is its own: it presses or toggles that control.
      const own =
        event.target instanceof HTMLButtonElement ||
        (event.target instanceof HTMLInputElement && event.target.type !== 'range')
      if (event.key === ' ' && !own) {
        event.preventDefault()
        setPaused((was) => !was)
      } else if (event.key === 'f' || event.key === 'F') {
        openFull()
      }
    }
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [open, running, openFull])

  // What the picture plays: the renderer's effects that are in the game, at their settings.
  const playing: StageEffect[] =
    motion.status === 'ready'
      ? motion.module.types
          .filter((t) => effects[t.type]?.on)
          // A spot being drawn that has no shape yet shows nothing until one is closed.
          .filter((t) => drawing?.type !== t.type || (effects[t.type]?.spot?.length ?? 0) > 0)
          // In the order the game is given them (by kind), so the layers stack the same.
          .sort((a, b) => (a.type < b.type ? -1 : 1))
          .map((t) => {
            const { settings, spot } = effects[t.type]!
            return { kind: t.type, settings: effectValues(t, settings), ...(spot && { spot }) }
          })
      : []
  // With no renderer named there are no effects to count; while it loads or failed, the saved count stands.
  const playingCount =
    motion.status === 'ready' ? playing.length : motion.status === 'none' ? 0 : null
  useEffect(() => {
    onEffectsOn?.(playingCount)
  }, [onEffectsOn, playingCount])
  if (motion.status === 'none') {
    return (
      <section className="panel movement" aria-label="Movement">
        <div className="movement-head">
          <h2>{MOVEMENT_WORDS.tab}</h2>
        </div>
        <p className="muted">{MOVEMENT_WORDS.notNamed}</p>
      </section>
    )
  }

  const ready = motion.status === 'ready'
  const chosenPatches = (patches ?? []).filter(
    (p): p is MovementPatch & { src: string } => p.src !== null && patchesOn.has(p.id),
  )
  const spotControls: SpotControls = {
    drawing: drawing?.type ?? null,
    why: picture === null && SPOT_WORDS.noPicture,
    onDraw,
    onClear,
    onPeek: setPeek,
    leftOut,
  }
  /** The groups, with spot links (the tab) or without (full screen, which only shows the lines). */
  const controls = (spot: SpotControls | undefined) => (
    <MotionControls
      patches={patches}
      patchesOn={patchesOn}
      onPatch={(id, on) => setPatchesOn((now) => toggle(now, id, on))}
      motion={motion}
      effects={effects}
      onEffect={onEffect}
      onSetting={onSetting}
      onCommit={() => persist()}
      onReset={onReset}
      onRemove={onRemove}
      status={status}
      onRetry={() => persist(failedSpot)}
      failedSpot={failedSpot}
      spot={spot}
    />
  )
  const failure =
    motion.status === 'failed' ? (
      <>
        <strong>{MOVEMENT_WORDS.failed}</strong>
        <code className="mono">{motion.message}</code>
        <button type="button" className="btn" onClick={retry}>
          {MOVEMENT_WORDS.tryAgain}
        </button>
      </>
    ) : null
  const drawName = drawing
    ? ((motion.status === 'ready'
        ? motion.module.types.find((t) => t.type === drawing.type)?.title
        : null) ?? drawing.type)
    : null
  const closed = (shape: [number, number][]) => {
    if (!drawing) return
    const spot = addShape(spotOf(drawing.type), shape)
    setSpot(drawing.type, spot)
    persist(true)
    draw({ ...drawing, placing: null, picked: spot.length - 1 })
  }
  const dropPicked = () => {
    if (!drawing || drawing.picked === null) return
    setSpot(drawing.type, dropShape(spotOf(drawing.type), drawing.picked))
    persist(true)
    draw({ ...drawing, picked: null, confirm: false })
  }
  const drawBar =
    drawing && drawName ? (
      <div ref={bar} className="spot-bar">
        {(() => {
          const words = drawing.confirm
            ? deleteAsk(spotOf(drawing.type)[drawing.picked ?? 0]?.length ?? 0)
            : drawing.placing
              ? newShapeBar(drawName)
              : drawingBar(drawName)
          return (
            <span className="spot-bar-words">
              <b>{words.lead}</b>
              {words.rest}
            </span>
          )
        })()}
        {drawing.confirm ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => draw({ ...drawing, confirm: false })}
            >
              {SPOT_WORDS.keep}
            </button>
            <button type="button" className="btn btn-primary" onClick={dropPicked}>
              {SPOT_WORDS.delete}
            </button>
          </>
        ) : (
          <>
            {!drawing.placing && (
              <button
                type="button"
                className="btn"
                onClick={() => draw({ ...drawing, placing: [], picked: null })}
              >
                {SPOT_WORDS.addShape}
              </button>
            )}
            {!drawing.placing && drawing.picked !== null && (
              <button
                type="button"
                className="btn"
                onClick={() => draw({ ...drawing, confirm: true })}
              >
                {SPOT_WORDS.deleteShape}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => finish(true)}>
              {SPOT_WORDS.finish}
            </button>
          </>
        )}
      </div>
    ) : null
  const peeked = peek && effects[peek]?.on ? effects[peek]?.spot : undefined
  const overlay =
    drawing || peeked ? (
      <SpotOverlay
        spot={drawing ? spotOf(drawing.type) : peeked!}
        mode={drawing ? 'draw' : 'peek'}
        picked={drawing?.picked ?? null}
        placing={drawing?.placing ?? null}
        onPick={(picked) => drawing && draw({ ...drawing, picked })}
        onPlace={(placing) => drawing && draw({ ...drawing, placing })}
        onClose={closed}
        onChange={(spot) => drawing && setSpot(drawing.type, spot)}
        onCommit={() => persist(true)}
      />
    ) : null
  const playLabel = paused ? MOVEMENT_WORDS.play : MOVEMENT_WORDS.pause

  let caption: string | null = null
  if (picture !== null) {
    if (motion.status === 'failed') caption = MOVEMENT_WORDS.failedCaption
    else if (row.chosenTake !== null) caption = takeCaption(row.chosenTake)
    else caption = MOVEMENT_WORDS.gameOwn
  }

  return (
    <section className="panel movement" aria-label="Movement">
      <div className="movement-head">
        <h2>{MOVEMENT_WORDS.tab}</h2>
        <span className="muted">{MOVEMENT_WORDS.beside}</span>
      </div>
      {reduced && running && (
        <p className="movement-reduced notice-warn">{MOVEMENT_WORDS.reduced}</p>
      )}
      <div className="movement-body">
        <div className="movement-picture">
          {drawBar}
          <div
            ref={wrap}
            className={full ? 'movement-wrap movement-wrap-full' : 'movement-wrap'}
            style={full ? undefined : { aspectRatio: `${row.width} / ${row.height}` }}
          >
            {picture === null ? (
              <div className="movement-empty">
                {motion.status === 'failed' && (
                  <div role="alert" className="movement-failure">
                    {failure}
                  </div>
                )}
                <strong>{MOVEMENT_WORDS.noTake}</strong>
                <span className="muted">{MOVEMENT_WORDS.chooseOnMake}</span>
                <button type="button" className="btn" onClick={onGoToMake}>
                  {MOVEMENT_WORDS.goToMake}
                </button>
              </div>
            ) : (
              <div className={ready ? 'movement-stage' : 'movement-stage movement-dim'}>
                <MotionStage
                  layers={{
                    src: picture,
                    size: { width: row.width, height: row.height },
                    patches: chosenPatches,
                  }}
                  module={ready ? motion.module : null}
                  effects={playing}
                  paused={paused}
                  running={open}
                  only={drawing?.type ?? null}
                  drift={drawing === null}
                  inside={drawing ? null : overlay}
                  onMissing={() => setMissing(src)}
                />
              </div>
            )}
            {ready && picture !== null && !full && drawing && overlay}
            {picture !== null && motion.status === 'loading' && (
              <div className="movement-over" role="status">
                {MOVEMENT_WORDS.loading}
              </div>
            )}
            {motion.status === 'failed' && picture !== null && (
              <div className="movement-over" role="alert">
                {failure}
              </div>
            )}
            {running && !full && (
              <>
                <button
                  type="button"
                  className="btn movement-pause"
                  onClick={() => setPaused((was) => !was)}
                >
                  {playLabel}
                </button>
                <button
                  ref={fullButton}
                  type="button"
                  className="btn movement-full"
                  onClick={openFull}
                >
                  {MOVEMENT_WORDS.fullScreen}
                </button>
              </>
            )}
            {running && full && (
              <aside className="movement-float" aria-label={row.title}>
                <div className="movement-float-head">
                  <strong>{row.title}</strong>
                  <button
                    type="button"
                    className="btn"
                    aria-label={paused ? 'Play' : 'Pause'}
                    onClick={() => setPaused((was) => !was)}
                  >
                    {paused ? '▶' : '❚❚'}
                  </button>
                  <button type="button" className="btn" onClick={() => setFolded((was) => !was)}>
                    {folded ? MOVEMENT_WORDS.show : MOVEMENT_WORDS.hide}
                  </button>
                  <button type="button" className="btn" onClick={closeFull}>
                    {MOVEMENT_WORDS.close}
                  </button>
                </div>
                {!folded && controls(undefined)}
              </aside>
            )}
          </div>
          {caption !== null && <p className="muted movement-caption">{caption}</p>}
        </div>
        <div className="movement-side">{controls(spotControls)}</div>
      </div>
    </section>
  )
}
