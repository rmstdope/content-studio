import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  NOTHING_TO_COPY,
  NO_COPY_MATCH,
  copyFooter,
  copyWindowTitle,
  croppedLine,
  scaledLine,
  filterCopySources,
  type CopyGroup,
  type CopySource,
} from '../../../core/imageCopy'
import { Overlay } from '../../components/Overlay'
import { off } from '../../off'

/**
 * The window that copies another image's picture into `title` as a take: a search line over a
 * grid of every image with a chosen take, by act. Picking a cell enables "Copy as a take"; double
 * click or Enter on a picked cell copies it too. Esc, Cancel, ✕ and the backdrop close it with
 * nothing copied. It owns only the search and the pick; `onCopy` does the copying and closes it.
 */
export function CopyImageDialog({
  title,
  groups,
  onCopy,
  onClose,
}: {
  /** The title of the image the copy goes into. */
  title: string
  groups: readonly CopyGroup[]
  onCopy: (source: CopySource) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const shown = useMemo(() => filterCopySources(groups, query), [groups, query])
  const everything = groups.flatMap((g) => g.images)
  const source = everything.find((i) => i.id === picked) ?? null
  const empty = everything.length === 0
  // Tab enters the grid once, at the pick or else the first image shown; the arrows move inside it.
  const visible = shown.flatMap((g) => g.images)
  const tabStop = (visible.some((i) => i.id === picked) ? picked : visible[0]?.id) ?? null

  useEffect(() => search.current?.focus(), [])
  // A pick that left the list (the list was refreshed underneath) is forgotten.
  useEffect(() => {
    if (picked && !source) setPicked(null)
  }, [picked, source])

  const cells = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]

  function onKeyDown(event: KeyboardEvent) {
    // The page's own keys are not heard while the window is open.
    event.nativeEvent.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const target = event.target as HTMLElement
    if (event.key === 'Tab') {
      const controls = [...(root.current?.querySelectorAll<HTMLElement>('input, button') ?? [])]
      const inside = controls.includes(target)
      const wrapTo = event.shiftKey
        ? !inside || target === controls[0]
          ? controls.at(-1)
          : null
        : !inside || target === controls.at(-1)
          ? controls[0]
          : null
      if (wrapTo) {
        event.preventDefault()
        wrapTo.focus()
      }
      return
    }
    const onCell = target.getAttribute('role') === 'option'
    if (event.key === 'Enter' && onCell) {
      event.preventDefault()
      const cell = everything.find((i) => i.id === target.dataset.image)
      if (cell && cell.id === picked) onCopy(cell)
      else if (cell) setPicked(cell.id)
      return
    }
    const arrows = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']
    if (!arrows.includes(event.key)) return
    const stops = cells()
    if (target === search.current) {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      stops[0]?.focus()
      return
    }
    if (!onCell) return
    event.preventDefault()
    const at = stops.indexOf(target)
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    if (!forward && at === 0 && event.key === 'ArrowUp') {
      search.current?.focus()
      return
    }
    stops[Math.max(0, Math.min(stops.length - 1, at + (forward ? 1 : -1)))]?.focus()
  }

  return (
    <Overlay>
      <div
        className="modal-back"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return
          // Without this the browser moves focus to the page after `onClose` has put it back.
          event.preventDefault()
          onClose()
        }}
      >
        <div
          className="modal copy-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="copy-image-title"
          ref={root}
        >
          <div className="copy-head">
            <h3 id="copy-image-title">{copyWindowTitle(title)}</h3>
            <button type="button" className="btn btn-ghost" aria-label="✕" onClick={onClose}>
              ✕
            </button>
          </div>
          <input
            ref={search}
            className="filter"
            placeholder="Find an image…"
            aria-label="Find an image…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="modal-list copy-body" role="listbox" aria-label="Images to copy">
            {empty ? (
              <div className="faint small modal-note">{NOTHING_TO_COPY}</div>
            ) : shown.length === 0 ? (
              <div className="faint small modal-note">{NO_COPY_MATCH(query)}</div>
            ) : (
              shown.map((group) => (
                <div className="group" key={group.id}>
                  <div className="label">{group.title}</div>
                  <div className="copy-grid">
                    {group.images.map((image) => (
                      <button
                        tabIndex={tabStop === image.id ? 0 : -1}
                        key={image.id}
                        type="button"
                        role="option"
                        className={`copy-cell${picked === image.id ? ' sel' : ''}`}
                        data-image={image.id}
                        aria-selected={picked === image.id}
                        title={image.title}
                        onClick={() => setPicked(image.id)}
                        onDoubleClick={() => onCopy(image)}
                      >
                        <img
                          src={`/api/images/${encodeURIComponent(image.id)}/takes/${image.take}`}
                          alt=""
                        />
                        <span className="copy-title">{image.title}</span>
                        {image.cropped ? (
                          <span className="small copy-cropped">{croppedLine(image.size)}</span>
                        ) : image.scaled ? (
                          <span className="faint small">{scaledLine(image.size)}</span>
                        ) : (
                          <span className="faint small">Take {image.take} in the game</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="modal-actions copy-foot">
            <span className="muted small grow">
              {source ? copyFooter(source.title, source.take) : ''}
            </span>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              {...off(!source && 'Pick an image first.')}
              onClick={() => source && onCopy(source)}
            >
              Copy as a take
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
