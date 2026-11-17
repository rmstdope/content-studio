import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageRow, SavedEffects } from '../../../core/images'
import {
  effectPlays,
  effectValues,
  startSettings,
  tieState,
  type TiePatch,
  type EffectSetting,
  type EffectType,
} from '../../../core/motion'
import { useImagePatches, useMotionRenderer, useSetImageEffects } from '../../api'
import { IMAGE_TAKE_UNKNOWN } from '../../imagesText'
import { MOVEMENT_WORDS, SAVED_FOR_MS, SAVING_AFTER_MS, takeCaption } from '../../motionText'
import { MotionControls, type MovementPatch, type SaveStatus } from './MotionControls'
import { MotionStage, type StageEffect } from './MotionStage'
import { useJobOpen } from './ImageJobTabs'
import { typingIn } from './useWorkbenchKeys'

/** Whether this computer asks for reduced motion. */
function asksForReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The tie an effect has to a patch, to carry over into its next saved form. */
function tieOf(saved: SavedEffects[string] | undefined) {
  return {
    ...(saved?.patch !== undefined && { patch: saved.patch }),
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
  const [paused, setPaused] = useState(false)
  const [full, setFull] = useState(false)
  const [folded, setFolded] = useState(false)
  const [missing, setMissing] = useState<string | null>(null)
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

  /** The patches an effect can be tied to: the game's, with whether each has a take to lay (true while that is not yet known). */
  const ties: TiePatch[] = row.patches.map((patch) => ({
    id: patch.id,
    title: patch.title,
    hasTake: patches === null ? true : patches.find((p) => p.id === patch.id)?.src != null,
  }))

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  /** Saves the effects as they are now; the latest save's outcome is the one shown. */
  const persist = useCallback(() => {
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
      setStatus(ok ? 'saved' : 'failed')
      if (ok) timers.current = [setTimeout(() => setStatus('idle'), SAVED_FOR_MS)]
    }
    save.mutate(latest.current, {
      onSuccess: (answer) => done(answer.ok),
      onError: () => done(false),
    })
  }, [save])

  /** Sets the effects here (the picture follows at once); saving is `persist`'s. */
  const set = (next: SavedEffects) => {
    latest.current = next
    setEffects(next)
  }
  const onEffect = (type: EffectType, on: boolean) => {
    const was = latest.current[type.type]
    // Every setting goes to the game: those the renderer has added since take their starting value.
    set({
      ...latest.current,
      [type.type]: {
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
        title: type.title,
        on: latest.current[type.type]?.on ?? true,
        ...tieOf(latest.current[type.type]),
        settings: startSettings(type),
      },
    })
    persist()
  }
  /** An effect is tied to a patch, or to none (null): saved, and the patch laid so the effect stays in sight. */
  const onTie = (type: EffectType, patchId: string | null) => {
    const was = latest.current[type.type]
    const {
      patch: _p,
      patchTitle: _t,
      ...rest
    } = was ?? { on: true, settings: startSettings(type) }
    const patch = ties.find((p) => p.id === patchId)
    set({
      ...latest.current,
      [type.type]: {
        ...rest,
        title: type.title,
        ...(patch && { patch: patch.id, patchTitle: patch.title }),
      },
    })
    if (patch?.hasTake) setPatchesOn((now) => toggle(now, patch.id, true))
    persist()
  }
  const onLay = (id: string) => setPatchesOn((now) => toggle(now, id, true))
  const onRemove = (type: string) => {
    const { [type]: _gone, ...rest } = latest.current
    set(rest)
    persist()
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

  // What the picture plays: the renderer's effects that are in the game, at their settings.
  const playing: StageEffect[] =
    motion.status === 'ready'
      ? motion.module.types
          .filter(
            (t) => effects[t.type]?.on && effectPlays(tieState(effects[t.type]!, ties, patchesOn)),
          )
          // In the order the game is given them (by kind), so the layers stack the same.
          .sort((a, b) => (a.type < b.type ? -1 : 1))
          .map((t) => ({ kind: t.type, settings: effectValues(t, effects[t.type]!.settings) }))
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
  const controls = (
    <MotionControls
      lockUnread={lockUnread}
      patches={patches}
      patchesOn={patchesOn}
      onPatch={(id, on) => setPatchesOn((now) => toggle(now, id, on))}
      motion={motion}
      effects={effects}
      onEffect={onEffect}
      onSetting={onSetting}
      onCommit={persist}
      onReset={onReset}
      onRemove={onRemove}
      ties={ties}
      onTie={onTie}
      onLay={onLay}
      status={status}
      onRetry={persist}
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
          <div
            ref={wrap}
            className={full ? 'movement-wrap movement-wrap-full' : 'movement-wrap'}
            style={full ? undefined : { aspectRatio: `${row.width} / ${row.height}` }}
          >
            {lockUnread ? (
              <div className="movement-empty movement-unknown" data-unknown="true">
                {motion.status === 'failed' && (
                  <div role="alert" className="movement-failure">
                    {failure}
                  </div>
                )}
                <strong>{MOVEMENT_WORDS.lockHeading}</strong>
                <span role="status">{IMAGE_TAKE_UNKNOWN}</span>
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
                  onMissing={() => setMissing(src)}
                />
              </div>
            )}
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
                {!folded && controls}
              </aside>
            )}
          </div>
          {caption !== null && <p className="muted movement-caption">{caption}</p>}
        </div>
        <div className="movement-side">{controls}</div>
      </div>
    </section>
  )
}
