import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// A DOM for this file only: React reads `window` when react-dom loads, so it is imported after.
GlobalRegistrator.register()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { SpendConfirm } = await import('./SpendConfirm')
const { pressBlankThenEscape } = await import('../../../test/pressBlank')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterAll(() => GlobalRegistrator.unregister())
afterEach(() => (document.body.innerHTML = ''))

/** The box over a credit read as `credit`, and how often it was cancelled. */
function show(credit: number) {
  const cancelled: true[] = []
  const container = document.createElement('div')
  document.body.append(container)
  act(() =>
    createRoot(container).render(
      createElement(SpendConfirm, {
        title: 'Audition voices',
        points: () => ['Takes are charged.'],
        model: 's2.1-pro',
        perTake: 0.01,
        suggested: 0.5,
        credit: { ok: true, credit },
        onRetry: () => {},
        busy: false,
        onPay: () => {},
        onCancel: () => cancelled.push(true),
      }),
    ),
  )
  return { container, cancelled }
}

describe('SpendConfirm', () => {
  for (const [state, credit] of [
    ['asking what to spend', 10],
    ['saying the audition can’t start', 0],
  ] as const) {
    it(`cancels on Escape after a press on a spot that is not a control, ${state}`, () => {
      const box = show(credit)
      act(() => pressBlankThenEscape(box.container.querySelector('h2')!))
      expect(box.cancelled).toHaveLength(1)
    })
  }
})
