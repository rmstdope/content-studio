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

  it('holds the zoom still while paused', () => {
    expect(css).toMatch(
      /\.movement-zoom\[data-paused='true'\]\s*\{[^}]*animation-play-state:\s*paused/,
    )
  })
})
