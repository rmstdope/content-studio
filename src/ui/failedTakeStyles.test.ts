import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`, outside any media query. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the failed take’s tile in the Takes row', () => {
  it('is a dashed red border on a dark red ground, over the thumb it is one of', () => {
    const tile = rule('.image-thumb-failed')
    expect(tile).toContain('border: 1px dashed var(--danger-ink)')
    expect(tile).toContain('background: var(--danger-bg)')
    expect(css.indexOf('\n.image-thumb-failed {')).toBeGreaterThan(css.indexOf('\n.image-thumb {'))
  })

  it('is as wide as the others, and only it grows with a long reason', () => {
    expect(rule('.image-thumb-failed')).not.toContain('width')
    expect(rule('.image-takes .image-thumbs')).toContain('align-items: flex-start')
    expect(rule('.image-thumb-why')).toContain('overflow-wrap: anywhere')
  })

  it('has Try again across the tile, as drawn', () => {
    expect(rule('.image-thumb-failed .btn')).toContain('align-self: stretch')
  })

  it('has a well with a red mark where the picture was, and says what happened in red', () => {
    expect(rule('.image-thumb-well')).toContain('color: var(--danger-ink)')
    expect(rule('.image-thumb-well')).toContain('background: var(--well)')
    expect(rule('.image-thumb-what')).toContain('color: var(--danger-ink)')
    expect(rule('.image-thumb-why')).toContain('color: var(--muted)')
  })
})
