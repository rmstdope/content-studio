import { afterAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { unregisterDom } from '../../../../test/dom'
// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register({ url: 'http://localhost/' })
const { act, createElement, createRef } = await import('react')
const { createRoot } = await import('react-dom/client')
const { FitPicture } = await import('./FitPicture')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterAll(unregisterDom)

/** The one element `FitPicture` draws with these props, unmounted after `look`. */
async function drawn(
  props: Parameters<typeof FitPicture>[0],
  look: (box: HTMLElement) => void,
): Promise<void> {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(createElement(FitPicture, props)))
  look(host.firstElementChild as HTMLElement)
  act(() => root.unmount())
}

describe('a picture’s box that fits the window (as-5068)', () => {
  it('carries the width rule’s class, the shape, and no wider than the pixels drawn', async () => {
    const game = { width: 160, height: 200 }
    await drawn({ shape: game, take: { width: 816, height: 1024 }, game }, (box) => {
      expect(box.tagName).toBe('DIV')
      expect(box.className).toBe('whole-in-view')
      expect(box.style.aspectRatio).toBe('160 / 200')
      expect(box.style.getPropertyValue('--bar-height')).toBe('')
      expect(box.style.maxWidth).toBe('816px')
    })
  })

  it('is as wide for the whole take as for the game’s cut of it (as-fuaz)', async () => {
    const take = { width: 816, height: 1024 }
    const game = { width: 160, height: 200 }
    for (const shape of [take, game]) {
      await drawn({ shape, take, game }, (box) => {
        expect(box.style.getPropertyValue('--picture-ratio')).toBe(String(816 / 1024))
        expect(box.style.maxWidth).toBe('816px')
      })
    }
  })

  it('takes a pinned bar’s height off the window’s, when there is one', async () => {
    const size = { width: 2, height: 1 }
    await drawn({ shape: size, take: size, game: size, barHeight: 112 }, (box) =>
      expect(box.style.getPropertyValue('--bar-height')).toBe('112px'),
    )
  })

  it('is an ordinary div besides: its own class, attributes, children and ref', async () => {
    const ref = createRef<HTMLDivElement>()
    await drawn(
      {
        shape: { width: 2, height: 1 },
        take: { width: 2, height: 1 },
        game: { width: 2, height: 1 },
        className: 'named-area-stage',
        role: 'status',
        ref,
        children: 'Words',
      },
      (box) => {
        expect(box.className).toBe('named-area-stage whole-in-view')
        expect(box.getAttribute('role')).toBe('status')
        expect(box.textContent).toBe('Words')
        expect(ref.current as unknown).toBe(box)
      },
    )
  })
})
