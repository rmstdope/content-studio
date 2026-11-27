import { type Chosen } from '../../../core/lockRead'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { ImageRow, SavedEffects, SavedZoom, SpotMark, SpotShape } from '../../../core/images'
import { zoomLook, zoomValues } from '../../../core/zoom'
import {
  effectPlays,
  effectValues,
  gameShapes,
  spotView,
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
  foldedDrawing,
  foldedPlacing,
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
import { clampFloat, readFloat, writeFloat, type FloatPlace } from './floatPlace'
import { SpotOverlay } from './SpotOverlay'
import { off } from '../../off'
import { handFocusOn } from './handFocusOn'
import { useJobOpen } from './ImageJobTabs'
import { typingIn } from './useWorkbenchKeys'

/** An effect's spot link, once its row has been drawn: the full-screen panel's when it is open, else the tab's. */
const spotLink = (type: string) =>
  document.querySelector<HTMLElement>(`.movement-float [data-spot-link="${type}"]`) ??
  document.querySelector<HTMLElement>(`.movement-side [data-spot-link="${type}"]`)

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
  /** The copy of the game's shape being started from, not yet the person's own; null once a change made it theirs, or when the game doesn't say where. */
  draft: SpotShape[] | null
}

/** How long Undo stays offered after a shape is taken away. */
const UNDO_FOR_MS = 8000

/** The shapes and mark just taken away from an effect, to bring back with Undo. */
interface Removed {
  type: string
  spot: SpotShape[]
  mark?: SpotMark
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
  chosen,
  onGoToMake,
  onEffectsOn,
}: {
  row: ImageRow
  /** The page's one answer (`imageChosen`): which take the game shows, or that it is not known. */
  chosen: Chosen
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
  // Shapes just taken away, offered back for a moment (never kept past this tab).
  const [removed, setRemoved] = useState<Removed | null>(null)
  const removedRef = useRef<Removed | null>(null)
  const removedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The effect whose shapes could not be taken away, so Try again takes them away again.
  const failedBack = useRef<string | null>(null)
  // The types the renderer says the game cannot place elsewhere, as of this render; null while the renderer is not loaded.
  const fixedTypes = useRef<ReadonlySet<string> | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const fullButton = useRef<HTMLButtonElement>(null)
  const floatBox = useRef<HTMLElement>(null)
  // Where the person left the full-screen panel (null: the top right), remembered on this computer.
  const [place, setPlace] = useState<FloatPlace | null>(() => readFloat())
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
  const src = !chosen.known
    ? null
    : chosen.take !== null
      ? `/api/images/${encodeURIComponent(row.id)}/takes/${chosen.take}`
      : row.gameFile?.exists
        ? `/api/images/${encodeURIComponent(row.id)}/current`
        : null
  const picture = src !== null && missing !== src ? src : null
  // Playing: the renderer is loaded and there is a picture to move; only then do the keys act.
  const running = motion.status === 'ready' && picture !== null
  fixedTypes.current =
    motion.status === 'ready'
      ? new Set(motion.module.types.filter((t) => t.placement === 'fixed').map((t) => t.type))
      : null

  const patches: MovementPatch[] | null = !chosen.known
    ? row.patches.map((patch) => ({ id: patch.id, title: patch.title, src: null }))
    : patchView && 'patches' in patchView
      ? row.patches.map((patch) => {
          const own = patchView.patches.find((p) => p.id === patch.id)?.chosen
          const n = own?.known ? own.take : null
          return {
            id: patch.id,
            title: patch.title,
            src:
              n !== null
                ? `/api/images/${encodeURIComponent(row.id)}/patches/${encodeURIComponent(patch.id)}/takes/${n}`
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
    (spot = false, onFail?: () => void) => {
      const mine = ++saves.current
      // Try again retries the latest save: only a revert's own save is retried as a revert.
      if (!onFail) failedBack.current = null
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
        if (!ok) onFail?.()
        if (ok) timers.current = [setTimeout(() => setStatus('idle'), SAVED_FOR_MS)]
      }
      // An effect the game cannot place elsewhere is marked so, so its kept shape is not exported.
      const marked: SavedEffects = Object.fromEntries(
        Object.entries(latest.current).map(([type, effect]) => {
          if (!fixedTypes.current) return [type, effect]
          const { fixed: _was, ...rest } = effect
          return [type, fixedTypes.current.has(type) ? { ...rest, fixed: true as const } : rest]
        }),
      )
      save.mutate(marked, {
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
    clearRemoved(type.type)
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
    clearRemoved(type.type)
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
    clearRemoved(type.type)
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
  /** Stops offering Undo; for a type, only when it is that type's. */
  const clearRemoved = (type?: string) => {
    if (type !== undefined && removedRef.current?.type !== type) return
    if (removedTimer.current) clearTimeout(removedTimer.current)
    removedTimer.current = null
    removedRef.current = null
    setRemoved(null)
  }
  /** Back to the game's / Remove it: the shapes and their mark go at once, and Undo is offered for a moment. */
  const onBack = (type: EffectType) => {
    setLeftOut(null)
    const was = latest.current[type.type]
    if (!was?.spot) return
    const { spot, mark, ...rest } = was
    const snapshot: Removed = { type: type.type, spot, ...(mark && { mark }) }
    failedBack.current = null
    set({ ...latest.current, [type.type]: rest })
    clearRemoved()
    removedRef.current = snapshot
    setRemoved(snapshot)
    removedTimer.current = setTimeout(() => clearRemoved(type.type), UNDO_FOR_MS)
    // A failed save puts the shapes back: the row stays on the person's own.
    persist(true, () => {
      failedBack.current = type.type
      clearRemoved(type.type)
      const now = latest.current[type.type]
      if (now) set({ ...latest.current, [type.type]: { ...now, spot, ...(mark && { mark }) } })
    })
    handFocusOn(() => spotLink(type.type))
  }
  /** Undo: the shapes and mark just taken away come back, saved at once. */
  const onUndo = (type: EffectType) => {
    const back = removedRef.current
    clearRemoved()
    const now = latest.current[type.type]
    if (!back || back.type !== type.type || !now) return
    set({
      ...latest.current,
      [type.type]: { ...now, spot: back.spot, ...(back.mark && { mark: back.mark }) },
    })
    persist(true)
    handFocusOn(() => spotLink(type.type))
  }
  /** An effect is tied to a patch, or to none (null): saved, and the patch laid (or taken off, for "not laid") so the effect stays in sight. */
  const onTie = (type: EffectType, choice: { patchId: string; without: boolean } | null) => {
    clearRemoved(type.type)
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
    clearRemoved(type)
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
    if (refocus) handFocusOn(() => spotLink(now.type))
  }, [])
  /** Sets an effect's spot (none: the game's) in the effects; saving is the caller's. A change makes the shape the person's own. */
  const setSpot = (type: string, spot: SpotShape[] | undefined) => {
    setLeftOut((was) => (was === type ? null : was))
    const now = drawingRef.current
    if (now?.type === type && now.draft) draw({ ...now, draft: null })
    const was = latest.current[type]
    if (!was) return
    const { spot: _old, mark, ...rest } = was
    set({ ...latest.current, [type]: spot ? { ...rest, spot, ...(mark && { mark }) } : rest })
  }
  /** Sets where an effect's light comes from (none: the middle of its shapes) in the effects; saving is the caller's. A change makes the shape the person's own. */
  const setMark = (type: string, mark: SpotMark | undefined) => {
    const now = drawingRef.current
    if (now?.type === type && now.draft) {
      const was = latest.current[type]
      if (was) set({ ...latest.current, [type]: { ...was, spot: now.draft } })
      draw({ ...now, draft: null })
    }
    const was = latest.current[type]
    if (!was) return
    const { mark: _old, ...rest } = was
    set({ ...latest.current, [type]: mark ? { ...rest, mark } : rest })
  }
  // Undo is not kept past the tab.
  useEffect(
    () => () => {
      if (removedTimer.current) clearTimeout(removedTimer.current)
    },
    [],
  )
  // Leaving the tab finishes drawing.
  useEffect(() => {
    if (!open) {
      finish(false)
      clearRemoved()
    }
  }, [open, finish])
  // Esc stops the shape being placed, or otherwise leaves drawing.
  useEffect(() => {
    if (!drawing) return
    const listen = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // In full screen Esc is the browser's, and leaves full screen: drawing carries on.
      if (document.fullscreenElement && document.fullscreenElement === wrap.current) return
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
      const shapes = now ? spotOf(now.type) : []
      if (!now || now.placing || now.confirm || shapes.length === 0) return
      const next = nudgeMark(saved?.mark ?? middleOf(shapes), event.key)
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
    if (barMode)
      bar.current?.querySelector<HTMLButtonElement>('button:not([data-bar-pause])')?.focus()
  }, [barMode, drawing?.type, full])
  /** The shapes of an effect as the picture has them: the person's own, else the game's copy being started from. */
  function spotOf(type: string): SpotShape[] {
    const now = drawingRef.current
    return latest.current[type]?.spot ?? (now?.type === type ? (now.draft ?? []) : [])
  }
  const onDraw = (type: EffectType) => {
    setLeftOut(null)
    clearRemoved(type.type)
    const own = latest.current[type.type]?.spot
    // Without shapes of their own, drawing starts from a copy of the game's; where the game doesn't say, empty.
    const copy = own
      ? []
      : gameShapes(type.placement).map((shape) => shape.map((c) => [...c] as [number, number]))
    const draft = copy.length > 0 ? copy : null
    draw({
      type: type.type,
      placing: !own && !draft ? [] : null,
      // The first shape is picked, so its corners show and can be dragged at once.
      picked: own?.length || draft ? 0 : null,
      confirm: false,
      draft,
    })
  }

  const toggle = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }

  const openFull = useCallback(() => {
    void wrap.current?.requestFullscreen?.()?.catch(() => {})
  }, [])
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

  // A failed save of a spot opens a folded panel, so the message is seen.
  const spotFailed = drawing !== null && status === 'failed' && failedSpot
  useEffect(() => {
    if (spotFailed) setFolded(false)
  }, [spotFailed])

  // The panel stays fully inside the screen when the window or the panel changes size.
  useEffect(() => {
    const box = floatBox.current
    if (!full || !place || !box) return
    const fit = () =>
      setPlace((now) => {
        if (!now) return now
        const next = clampFloat(
          now,
          { width: box.offsetWidth, height: box.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        )
        return next.left === now.left && next.top === now.top ? now : next
      })
    fit()
    window.addEventListener('resize', fit)
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    watch?.observe(box)
    return () => {
      window.removeEventListener('resize', fit)
      watch?.disconnect()
    }
  }, [full, place !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The grip is pressed: the panel follows the pointer, held inside the screen, and its place is kept when let go. */
  const grab = (event: React.PointerEvent) => {
    const box = floatBox.current
    if (!box) return
    event.preventDefault()
    const from = box.getBoundingClientRect()
    const dx = event.clientX - from.left
    const dy = event.clientY - from.top
    let last: FloatPlace | null = null
    const at = (e: PointerEvent | MouseEvent): FloatPlace =>
      clampFloat(
        { left: e.clientX - dx, top: e.clientY - dy },
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      )
    const move = (e: Event) => {
      last = at(e as PointerEvent)
      setPlace(last)
    }
    const end = (keep: boolean) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      if (keep && last) writeFloat(last)
    }
    // A cancelled pointer ends the drag where it is, like a release.
    const up = () => end(true)
    const cancel = up
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
  }

  // What the picture plays: the renderer's effects that are in the game, at their settings.
  const playing: StageEffect[] =
    motion.status === 'ready'
      ? motion.module.types
          .filter(
            (t) => effects[t.type]?.on && effectPlays(tieState(effects[t.type]!, ties, patchesOn)),
          )
          // While a spot is drawn only its effect plays, and it shows nothing until a shape is closed
          // (or it starts from a copy of the game's).
          .filter(
            (t) =>
              drawing === null ||
              (drawing.type === t.type &&
                ((effects[t.type]?.spot?.length ?? 0) > 0 || drawing.draft !== null)),
          )
          // In the order the game is given them (by kind), so the layers stack the same.
          .sort((a, b) => (a.type < b.type ? -1 : 1))
          .map((t) => {
            const { settings, mark } = effects[t.type]!
            // The game's shape, and an effect the game cannot place elsewhere: the renderer is handed none.
            const spot = t.placement === 'fixed' ? undefined : effects[t.type]!.spot
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
  /** Try again after a failed save: a revert is retried as one, anything else as the latest save. */
  function retrySave() {
    const again = failedBack.current
    const type =
      motion.status === 'ready' ? motion.module.types.find((t) => t.type === again) : undefined
    if (type) onBack(type)
    else persist(failedSpot)
  }
  const spotControls: SpotControls = {
    drawing: drawing?.type ?? null,
    why: picture === null && SPOT_WORDS.noPicture,
    onDraw,
    onBack,
    onUndo,
    undo: removed?.type ?? null,
    onPeek: setPeek,
    leftOut,
  }
  /** The groups, with spot links (the tab) or without (full screen, which only shows the lines). */
  const controls = (spot: SpotControls | undefined) => (
    <MotionControls
      chosen={chosen}
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
      onRetry={retrySave}
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
    draw({ ...drawingRef.current!, placing: null, picked: spot.length - 1 })
  }
  const dropPicked = () => {
    if (!drawing || drawing.picked === null) return
    setSpot(drawing.type, dropShape(spotOf(drawing.type), drawing.picked))
    persist(true)
    draw({ ...drawingRef.current!, picked: null, confirm: false })
  }
  // The bar holds, unseen in the one cell with what it says and shows now, the words of every
  // step of drawing and its widest row of buttons: it is as tall as the tallest of them whichever
  // step is shown, so the picture below does not move under the pointer as the steps change.
  const barSpot = drawing ? spotOf(drawing.type) : []
  const barWords =
    drawing && drawName
      ? drawing.confirm
        ? deleteAsk(barSpot[drawing.picked ?? 0]?.length ?? 0)
        : drawing.placing && (drawing.placing.length > 0 || barSpot.length > 0)
          ? newShapeBar(drawName, { esc: !full })
          : drawingBar(
              drawName,
              drawing.draft ? 'fromGame' : barSpot.length === 0 ? 'empty' : 'own',
              { esc: !full },
            )
      : null
  // The tab's bar keeps one height through every step (full screen's box has no picture to keep still).
  const barSteps =
    drawName && !full
      ? [
          drawingBar(drawName, 'fromGame'),
          drawingBar(drawName, 'own'),
          drawingBar(drawName, 'empty'),
          newShapeBar(drawName),
          deleteAsk(Math.max(0, ...barSpot.map((shape) => shape.length))),
        ]
      : []
  const stopShape = () => drawing && draw({ ...drawing, placing: null })
  // The buttons of the bar's ordinary steps, in the one order they sit in: the shown row is the
  // ones the step shows, and the room held for them (the tab only) is every one, unseen.
  const playLabel = paused ? MOVEMENT_WORDS.play : MOVEMENT_WORDS.pause
  const slots = drawing
    ? [
        {
          key: 'pause',
          word: MOVEMENT_WORDS.pause,
          shown: !full,
          button: (
            <button
              key="pause"
              type="button"
              className="btn"
              data-bar-pause
              onClick={() => setPaused((was) => !was)}
            >
              {playLabel}
            </button>
          ),
        },
        {
          key: 'add',
          word: SPOT_WORDS.addShape,
          shown: !drawing.placing,
          button: (
            <button
              key="add"
              type="button"
              className="btn"
              onClick={() => draw({ ...drawing, placing: [], picked: null })}
            >
              {SPOT_WORDS.addShape}
            </button>
          ),
        },
        {
          key: 'deleteShape',
          word: SPOT_WORDS.deleteShape,
          shown: !drawing.placing && drawing.picked !== null,
          button: (
            <button
              key="deleteShape"
              type="button"
              className="btn"
              onClick={() => draw({ ...drawing, confirm: true })}
            >
              {SPOT_WORDS.deleteShape}
            </button>
          ),
        },
        {
          key: 'light',
          word: SPOT_WORDS.lightFromMiddle,
          shown: !drawing.placing && barSpot.length > 0,
          button: (
            <button
              key="light"
              type="button"
              className="btn"
              {...off(latest.current[drawing.type]?.mark === undefined && SPOT_WORDS.alreadyMiddle)}
              onClick={() => {
                if (latest.current[drawing.type]?.mark === undefined) return
                setMark(drawing.type, undefined)
                persist(true)
              }}
            >
              {SPOT_WORDS.lightFromMiddle}
            </button>
          ),
        },
        {
          key: 'stop',
          word: SPOT_WORDS.stopShape,
          fullOnly: true,
          shown: full && drawing.placing !== null,
          button: (
            <button key="stop" type="button" className="btn" onClick={stopShape}>
              {SPOT_WORDS.stopShape}
            </button>
          ),
        },
        {
          key: 'finish',
          word: SPOT_WORDS.finish,
          primary: true,
          shown: true,
          button: (
            <button
              key="finish"
              type="button"
              className="btn btn-primary"
              onClick={() => finish(true)}
            >
              {SPOT_WORDS.finish}
            </button>
          ),
        },
      ]
    : []
  /** The drawing words and buttons: above the picture on the tab, in the floating panel in full screen. */
  const drawBox =
    drawing && barWords ? (
      <div ref={bar} className={full ? 'spot-bar spot-bar-float' : 'spot-bar'}>
        <span className="spot-bar-words">
          <span className="spot-bar-now">
            <b>{barWords.lead}</b>
            {barWords.rest}
          </span>
          {barSteps.map((step) => (
            <span key={step.lead + step.rest} className="spot-bar-room" aria-hidden="true">
              <b>{step.lead}</b>
              {step.rest}
            </span>
          ))}
        </span>
        <span className="spot-bar-buttons">
          <span className={drawing.confirm ? 'spot-bar-now spot-bar-ask' : 'spot-bar-now'}>
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
              <>{slots.filter((slot) => slot.shown).map((slot) => slot.button)}</>
            )}
          </span>
          {!full && (
            <span className="spot-bar-room" aria-hidden="true">
              {slots
                .filter((slot) => !slot.fullOnly)
                .map((slot) => (
                  <span key={slot.key} className={slot.primary ? 'btn btn-primary' : 'btn'}>
                    {slot.word}
                  </span>
                ))}
            </span>
          )}
        </span>
        {full && status === 'failed' && failedSpot && (
          <p role="alert" className="movement-save-failed">
            {SPOT_WORDS.saveFailed}{' '}
            <button type="button" className="btn" onClick={retrySave}>
              {MOVEMENT_WORDS.tryAgain}
            </button>
          </p>
        )}
      </div>
    ) : null
  const typeOf = (kind: string) =>
    motion.status === 'ready' ? motion.module.types.find((t) => t.type === kind) : undefined
  // Pointing at an effect's row outlines the shapes it plays in: the game's dashed, your own solid
  // (the game's faint beneath); an effect that is off, or that the game cannot move, shows nothing.
  const peekType = peek && effects[peek]?.on ? typeOf(peek) : undefined
  const peekView = peekType ? spotView(peekType.placement, effects[peekType.type]) : undefined
  const peekedOwn = peekView?.who === 'own' ? (effects[peek!]?.spot ?? []) : []
  const peekedGame = peekType && peekView?.who !== 'fixed' ? gameShapes(peekType.placement) : []
  const peekedMark = peekedOwn.length > 0 ? (effects[peek!]?.mark ?? null) : null
  const drawnSpot = drawing ? spotOf(drawing.type) : []
  const drawnMark =
    !drawing || drawnSpot.length === 0 || drawing.draft
      ? null
      : (latest.current[drawing.type]?.mark ?? middleOf(drawnSpot))
  const overlay =
    drawing || peekedOwn.length > 0 || peekedGame.length > 0 ? (
      <SpotOverlay
        spot={drawing ? drawnSpot : peekedOwn}
        game={drawing ? gameShapes(typeOf(drawing.type)?.placement) : peekedGame}
        gameFaint={drawing ? true : peekedOwn.length > 0}
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

  let caption: string | null = null
  if (picture !== null) {
    if (motion.status === 'failed') caption = MOVEMENT_WORDS.failedCaption
    else if (chosen.known && chosen.take !== null) caption = takeCaption(chosen.take, paused)
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
          {!full && drawBox}
          <div className="movement-frame">
            <div
              ref={wrap}
              className={full ? 'movement-wrap movement-wrap-full' : 'movement-wrap'}
              style={
                full
                  ? picture !== null && chosen.known
                    ? ({ '--ar': row.width / row.height } as CSSProperties)
                    : undefined
                  : ({
                      aspectRatio: `${row.width} / ${row.height}`,
                      // Only a picture is fitted to the window; the empty and "not known" stages stay as wide as the column.
                      ...(picture !== null && chosen.known && { '--ar': row.width / row.height }),
                    } as CSSProperties)
              }
            >
              {!chosen.known ? (
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
                    zoom={drawing === null ? zoomLook(zoom ?? zoomValues(undefined)) : null}
                    inside={drawing && !full ? null : overlay}
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
              {running && !full && !drawing && (
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
                <aside
                  ref={floatBox}
                  className="movement-float"
                  aria-label={row.title}
                  style={place ? { left: place.left, top: place.top, right: 'auto' } : undefined}
                >
                  <div className="movement-float-head">
                    <span className="movement-float-grip" aria-hidden="true" onPointerDown={grab}>
                      ⋮⋮
                    </span>
                    <strong>
                      {drawing && folded
                        ? drawing.placing
                          ? foldedPlacing(drawName ?? '')
                          : foldedDrawing(drawName ?? '')
                        : row.title}
                    </strong>
                    {!(drawing?.placing && folded) && (
                      <button
                        type="button"
                        className="btn"
                        aria-label={paused ? 'Play' : 'Pause'}
                        onClick={() => setPaused((was) => !was)}
                      >
                        {paused ? '▶' : '❚❚'}
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => setFolded((was) => !was)}>
                      {folded ? MOVEMENT_WORDS.show : MOVEMENT_WORDS.hide}
                    </button>
                    {drawing && folded && drawing.placing && (
                      <button type="button" className="btn" onClick={stopShape}>
                        {SPOT_WORDS.stopShape}
                      </button>
                    )}
                    {drawing && folded && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setFolded(false)
                          finish(true)
                        }}
                      >
                        {SPOT_WORDS.finish}
                      </button>
                    )}
                    <button type="button" className="btn" onClick={closeFull}>
                      {MOVEMENT_WORDS.close}
                    </button>
                  </div>
                  {!folded && (drawBox ?? controls(spotControls))}
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
