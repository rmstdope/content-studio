import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageRow } from '../../../core/images'
import { useImagePatches, useMotionRenderer } from '../../api'
import { MOVEMENT_WORDS, takeCaption } from '../../motionText'
import { MotionControls, type MovementPatch } from './MotionControls'
import { MotionStage } from './MotionStage'
import { useJobOpen } from './ImageJobTabs'
import { typingIn } from './useWorkbenchKeys'

/** Whether this computer asks for reduced motion. */
function asksForReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * An image's Movement tab: the chosen take drawn moving by the project's own motion renderer, with
 * the patches and the renderer's effects to switch on for looking, in the page and full screen.
 * Nothing is saved: every switch goes back off when the tab is left, and it always starts playing.
 */
export function MovementPanel({ row, onGoToMake }: { row: ImageRow; onGoToMake: () => void }) {
  const open = useJobOpen()
  const { state: motion, retry } = useMotionRenderer(open)
  const patchView = useImagePatches(row.id).data
  const [patchesOn, setPatchesOn] = useState<ReadonlySet<string>>(new Set())
  const [effectsOn, setEffectsOn] = useState<ReadonlySet<string>>(new Set())
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
    setEffectsOn(new Set())
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
        event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement
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
  const types = ready ? motion.module.types.filter((t) => effectsOn.has(t.type)) : []
  const controls = (
    <MotionControls
      patches={patches}
      patchesOn={patchesOn}
      onPatch={(id, on) => setPatchesOn((now) => toggle(now, id, on))}
      motion={motion}
      effectsOn={effectsOn}
      onEffect={(type, on) => setEffectsOn((now) => toggle(now, type, on))}
      hasPicture={picture !== null}
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
                  effects={types}
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
