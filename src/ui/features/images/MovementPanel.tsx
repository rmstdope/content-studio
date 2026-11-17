import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type {
  ImageRow,
  SavedEffects,
  SavedZoom,
  SpotMark,
  SpotShape,
} from '../../../core/images'
import { zoomLook, zoomValues } from '../../../core/zoom'
import {
  effectPlays,
  effectValues,
  startSettings,
  tieState,
  type TiePatch,
  type EffectSetting,
  type EffectType,
} from '../../../core/motion'
import { addShape, dropShape, middleOf, nudgeMark } from '../../../core/spot'
import { useImagePatches, useMotionRenderer, useSetImageEffects, useSetImageZoom } from '../../api'
import { IMAGE_TAKE_UNKNOWN } from '../../imagesText'
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
import { movementRoom } from './movementRoom'
import { SpotOverlay } from './SpotOverlay'
import { off } from '../../off'
import { useJobOpen } from './ImageJobTabs'
import { typingIn } from './useWorkbenchKeys'

/** Puts focus on an effect's spot link once its row has been drawn again. */
function focusSpotLink(type: string) {
  setTimeout(
    () => document.querySelector<HTMLElement>(`.movement-side [data-spot-link="${type}"]`)?.focus(),
    0,
  )
}

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

/** The tie an effect has to a patch, to carry over into its next saved form. */
function tieOf(saved: SavedEffects[string] | undefined) {
  return {
    ...(saved?.patch !== undefined && { patch: saved.patch }),
    ...(saved?.unlessPatch !== undefined && { unlessPatch: saved.unlessPatch }),
    ...(saved?.patchTitle !== undefined && { patchTitle: saved.patchTitle }),
  }
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
  lockUnread,
  onGoToMake,
  onEffectsOn,
}: {
  row: ImageRow
  /** The page's one answer (`imageLockUnread`): which take the game shows is not known. */
  lockUnread: boolean
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
  // The image's slow zoom as set here (undefined: nothing saved, the game's own), with its own save.
  const [zoom, setZoom] = useState<SavedZoom | undefined>(() => row.zoom)
  const latestZoom = useRef(zoom)
  const [zoomStatus, setZoomStatus] = useState<SaveStatus>('idle')
  const saveZoom = useSetImageZoom(row.id)
  const zoomSaves = useRef(0)
  const zoomTimers = useRef<ReturnType<typeof setTimeout>[]>([])
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
  const column = useRef<HTMLDivElement>(null)
  // The stage's room: what the window leaves below where the frame starts on the page, less the
  // caption and its gap and the panel's bottom padding. Read from the nodes as they are now, so it
  // is right after the panel's parts come and go; worked out after every render and every resize.
  const fit = useRef(() => {})
  fit.current = () => {
    const el = column.current
    const frame = el?.querySelector<HTMLElement>('.movement-frame')
    if (!el || !frame) return
    // The page may scroll inside a container, so the frame's place on the page is its place on
    // the screen plus how far each ancestor has scrolled.
    const onScreen = frame.getBoundingClientRect().top
    let scrolled = 0
    for (let up = el.parentElement; up; up = up.parentElement) scrolled += up.scrollTop
    const top = onScreen + scrolled
    // The image's tabs, when the stage starts too low to fit: the room is then what is below them.
    const tabs = document.querySelector<HTMLElement>('.job-tabs')
    const caption = el.querySelector<HTMLElement>('.movement-caption')
    const gap = parseFloat(getComputedStyle(el).rowGap) || 0
    const pad = parseFloat(getComputedStyle(el.closest('.panel') ?? el).paddingBottom) || 0
    const below = (caption ? caption.offsetHeight + gap : 0) + pad
    el.style.setProperty(
      '--movement-room',
      `${movementRoom({
        windowHeight: window.innerHeight,
        top,
        below,
        ...(tabs && { tabs: tabs.getBoundingClientRect().top + scrolled }),
      })}px`,
    )
  }
  useLayoutEffect(() => fit.current())
  useEffect(() => {
    const onResize = () => fit.current()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
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

  // While the lock cannot be read no take is known to be chosen: no picture, none of its patches.
  const src = lockUnread
    ? null
    : row.chosenTake !== null
      ? `/api/images/${encodeURIComponent(row.id)}/takes/${row.chosenTake}`
      : row.gameFile?.exists
        ? `/api/images/${encodeURIComponent(row.id)}/current`
        : null
  const picture = src !== null && missing !== src ? src : null
  // Playing: the renderer is loaded and there is a picture to move; only then do the keys act.
  const running = motion.status === 'ready' && picture !== null

  const patches: MovementPatch[] | null = lockUnread
    ? row.patches.map((patch) => ({ id: patch.id, title: patch.title, src: null }))
    : patchView && 'patches' in patchView
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

  /** The patches an effect can be tied to: the game's, with whether each has a take to lay (true while that is not yet known, and if it could not be loaded). */
  const ties: TiePatch[] = row.patches.map((patch) => ({
    id: patch.id,
    title: patch.title,
    hasTake: patches === null ? true : patches.find((p) => p.id === patch.id)?.src != null,
  }))

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      zoomTimers.current.forEach(clearTimeout)
    },
    [],
  )

  /** Saves the zoom as it is now (none saved: null); the latest save's outcome is the one shown. */
  const persistZoom = useCallback(() => {
    const mine = ++zoomSaves.current
    zoomTimers.current.forEach(clearTimeout)
    zoomTimers.current = [
      setTimeout(() => {
        if (zoomSaves.current === mine) setZoomStatus('saving')
      }, SAVING_AFTER_MS),
    ]
    const done = (ok: boolean) => {
      if (zoomSaves.current !== mine) return
      zoomTimers.current.forEach(clearTimeout)
      setZoomStatus(ok ? 'saved' : 'failed')
      if (ok) zoomTimers.current = [setTimeout(() => setZoomStatus('idle'), SAVED_FOR_MS)]
    }
    saveZoom.mutate(latestZoom.current ?? null, {
      onSuccess: (answer) => done(answer.ok),
      onError: () => done(false),
    })
  }, [saveZoom])
  /** Sets the zoom here (the picture follows at once); saving is `persistZoom`'s. */
  const setZoomNow = (next: SavedZoom | undefined) => {
    latestZoom.current = next
    setZoom(next)
  }
  const onZoomOn = (on: boolean) => {
    setZoomNow({ ...(latestZoom.current ?? zoomValues(undefined)), on })
    persistZoom()
  }
  const onZoomValue = (which: 'seconds' | 'percent', value: number) =>
    setZoomNow({ ...(latestZoom.current ?? zoomValues(undefined)), [which]: value })
  const onZoomReset = () => {
    setZoomNow(undefined)
    persistZoom()
  }

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
        ...tieOf(was),
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
        ...tieOf(was),
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
        ...tieOf(latest.current[type.type]),
        settings: startSettings(type),
      },
    })
    persist()
  }
  const onClear = (type: EffectType) => {
    setLeftOut(null)
    const was = latest.current[type.type]
    if (!was) return
    const { spot: _gone, mark: _mark, ...rest } = was
    set({ ...latest.current, [type.type]: rest })
    persist(true)
    focusSpotLink(type.type)
  }
  /** An effect is tied to a patch, or to none (null): saved, and the patch laid (or taken off, for "not laid") so the effect stays in sight. */
  const onTie = (type: EffectType, choice: { patchId: string; without: boolean } | null) => {
    const was = latest.current[type.type]
    const {
      patch: _p,
      unlessPatch: _u,
      patchTitle: _t,
      ...rest
    } = was ?? { on: true, settings: startSettings(type) }
    const patch = ties.find((p) => p.id === choice?.patchId)
    set({
      ...latest.current,
      [type.type]: {
        ...rest,
        title: type.title,
        ...(patch && {
          [choice!.without ? 'unlessPatch' : 'patch']: patch.id,
          patchTitle: patch.title,
        }),
      },
    })
    if (patch?.hasTake) setPatchesOn((now) => toggle(now, patch.id, !choice!.without))
    persist()
  }
  const onLay = (id: string) => setPatchesOn((now) => toggle(now, id, true))
  const onTakeOff = (id: string) => setPatchesOn((now) => toggle(now, id, false))
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
    if (refocus) focusSpotLink(now.type)
  }, [])
  /** Sets an effect's spot (none: the whole picture) in the effects; saving is the caller's. */
  const setSpot = (type: string, spot: SpotShape[] | undefined) => {
    setLeftOut((was) => (was === type ? null : was))
    const was = latest.current[type]
    if (!was) return
    const { spot: _old, mark, ...rest } = was
    set({ ...latest.current, [type]: spot ? { ...rest, spot, ...(mark && { mark }) } : rest })
  }
  /** Sets where an effect's light comes from (none: the middle of its shapes) in the effects; saving is the caller's. */
  const setMark = (type: string, mark: SpotMark | undefined) => {
    const was = latest.current[type]
    if (!was) return
    const { mark: _old, ...rest } = was
    set({ ...latest.current, [type]: mark ? { ...rest, mark } : rest })
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
  // Alt with the arrows nudges the light's mark, each press saved.
  useEffect(() => {
    if (!drawing) return
    const listen = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || typingIn(event.target)) return
      const now = drawingRef.current
      const saved = now && latest.current[now.type]
      if (!now || now.placing || now.confirm || !saved?.spot?.length) return
      const next = nudgeMark(saved.mark ?? middleOf(saved.spot), event.key)
      if (!next) return
      event.preventDefault()
      setMark(now.type, next)
      persist(true)
    }
    document.addEventListener('keydown', listen)
    return () => document.removeEventListener('keydown', listen)
  }, [drawing === null]) // eslint-disable-line react-hooks/exhaustive-deps
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
          .filter(
            (t) => effects[t.type]?.on && effectPlays(tieState(effects[t.type]!, ties, patchesOn)),
          )
          // A spot being drawn that has no shape yet shows nothing until one is closed.
          .filter((t) => drawing?.type !== t.type || (effects[t.type]?.spot?.length ?? 0) > 0)
          // In the order the game is given them (by kind), so the layers stack the same.
          .sort((a, b) => (a.type < b.type ? -1 : 1))
          .map((t) => {
            const { settings, spot, mark } = effects[t.type]!
            return {
              kind: t.type,
              settings: effectValues(t, settings),
              ...(spot && { spot }),
              ...(spot && mark && { mark }),
            }
          })
      : []
  // The count is the renderer's effects that are on, tied to a patch or not, playing now or not.
  // With no renderer named there are no effects to count; while it loads or failed, the saved count stands.
  const onCount =
    motion.status === 'ready'
      ? motion.module.types.filter((t) => effects[t.type]?.on).length
      : motion.status === 'none'
        ? 0
        : null
  useEffect(() => {
    onEffectsOn?.(onCount)
  }, [onEffectsOn, onCount])
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
      lockUnread={lockUnread}
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
      ties={ties}
      onTie={onTie}
      onTakeOff={onTakeOff}
      onLay={onLay}
      zoom={zoom}
      zoomStatus={zoomStatus}
      onZoomOn={onZoomOn}
      onZoomValue={onZoomValue}
      onZoomCommit={persistZoom}
      onZoomReset={onZoomReset}
      onZoomRetry={persistZoom}
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
            {!drawing.placing && spotOf(drawing.type).length > 0 && (
              <button
                type="button"
                className="btn"
                {...off(
                  latest.current[drawing.type]?.mark === undefined && SPOT_WORDS.alreadyMiddle,
                )}
                onClick={() => {
                  if (latest.current[drawing.type]?.mark === undefined) return
                  setMark(drawing.type, undefined)
                  persist(true)
                }}
              >
                {SPOT_WORDS.lightFromMiddle}
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
  const peekedMark = peek && effects[peek]?.on && peeked ? (effects[peek]?.mark ?? null) : null
  const drawnSpot = drawing ? spotOf(drawing.type) : []
  const drawnMark =
    !drawing || drawnSpot.length === 0
      ? null
      : (latest.current[drawing.type]?.mark ?? middleOf(drawnSpot))
  const overlay =
    drawing || peeked ? (
      <SpotOverlay
        spot={drawing ? spotOf(drawing.type) : peeked!}
        mode={drawing ? 'draw' : 'peek'}
        picked={drawing?.picked ?? null}
        placing={drawing?.placing ?? null}
        onPick={(picked) => drawing && draw({ ...drawing, picked })}
        onPlace={(placing) => drawing && draw({ ...drawing, placing })}
        mark={drawing ? drawnMark : peekedMark}
        onMark={(mark) => drawing && setMark(drawing.type, mark)}
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
        <div ref={column} className="movement-picture">
          {drawBar}
          <div className="movement-frame">
            <div
              ref={wrap}
              className={full ? 'movement-wrap movement-wrap-full' : 'movement-wrap'}
              style={
                full
                  ? undefined
                  : ({
                      aspectRatio: `${row.width} / ${row.height}`,
                      // Only a picture is fitted to the window; the empty and "not known" stages stay as wide as the column.
                      ...(picture !== null && !lockUnread && { '--ar': row.width / row.height }),
                    } as CSSProperties)
              }
            >
              {lockUnread ? (
                <div className="movement-empty movement-unknown" data-unknown="true">
                  {motion.status === 'failed' && (
                    <div role="alert" className="movement-failure">
                      {failure}
                    </div>
                  )}
                  <strong className="movement-unknown-heading">{MOVEMENT_WORDS.lockHeading}</strong>
                  <span role="status" className="muted">
                    {IMAGE_TAKE_UNKNOWN}
                  </span>
                </div>
              ) : picture === null ? (
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
                    zoom={drawing === null ? zoomLook(zoom ?? zoomValues(undefined)) : null}
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
                <div className="movement-buttons">
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
                </div>
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
          </div>
          {caption !== null && <p className="muted movement-caption">{caption}</p>}
        </div>
        <div className="movement-side">{controls(spotControls)}</div>
      </div>
    </section>
  )
}
