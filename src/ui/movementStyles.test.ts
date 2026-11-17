import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The body of the first rule for `selector`, or nothing when there is none. */
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
}

describe('the Movement tab’s layout', () => {
  it('puts the picture beside a side column of about 300 px, and stacks them in a narrow window', () => {
    expect(rule('.movement-body')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 300px/)
    const narrow = css.slice(css.indexOf('@container panel (max-width: 800px) {\n  .movement-body'))
    expect(narrow.slice(0, narrow.indexOf('\n}\n'))).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\)/,
    )
  })

  it('fits the stage to the window: a dark frame centres a stage as wide as the room allows at its shape, as the measured room allows', () => {
    const frame = rule('.movement-frame')
    expect(frame).toMatch(/background:\s*var\(--inset\)/)
    expect(frame).toMatch(/justify-content:\s*center/)
    expect(rule('.movement-wrap')).toMatch(
      /width:\s*min\(100%, calc\(var\(--movement-room\) \* var\(--ar\)\)\)/,
    )
    // The room itself is measured in MovementPanel (movementRoom); the CSS holds only a fallback.
    expect(rule('.movement-picture')).toMatch(/--movement-room:\s*60dvh/)
    expect(rule('.movement-wrap-full')).toMatch(/width:\s*100%/)
  })

  it('lets long names and settings wrap', () => {
    expect(rule('.movement-switch')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule('.movement-settings')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('scrolls the full-screen panel inside itself, never taller than the screen less a margin, and as wide as the screen less 32 px', () => {
    const float = rule('.movement-float')
    expect(float).toMatch(/max-height:\s*calc\(100% - 32px\)/)
    expect(float).toMatch(/overflow:\s*auto/)
    expect(float).toMatch(/max-width:\s*calc\(100% - 32px\)/)
  })

  it('centres Try again and Go to Make under their message, over the shared button’s flex-start', () => {
    const centred = /([^{}]+)\{[^}]*align-self:\s*center/g
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(centred)].flatMap((m) =>
      (m[1] ?? '').split(',').map((s) => s.trim()),
    )
    for (const stage of ['.movement-empty', '.movement-over', '.movement-failure'])
      expect(selectors).toContain(`${stage} .btn`)
  })

  it('holds the zoom still while paused', () => {
    expect(css).toMatch(
      /\.movement-zoom\[data-paused='true'\]\s*\{[^}]*animation-play-state:\s*paused/,
    )
  })
})
