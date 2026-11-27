import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/**
 * The stylesheet's rules as `scope | selector` keys, one per rule block: the scope is the
 * enclosing at-rule (`@media …`) or empty at the top level. Comments are dropped first.
 */
function ruleKeys(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const keys: string[] = []
  const scopes: string[] = []
  // What each open brace is: an at-rule's name (its scope) or '' for a rule's own block.
  const open: string[] = []
  let prelude = ''
  for (const char of text) {
    if (char === '{') {
      const head = prelude.trim().replace(/\s+/g, ' ')
      const scoped = head.startsWith('@')
      if (scoped) scopes.push(head)
      else if (!open.includes('') && !scopes.some((scope) => scope.startsWith('@keyframes'))) {
        keys.push(`${scopes.join(' > ')} | ${head}`)
      }
      open.push(scoped ? head : '')
      prelude = ''
    } else if (char === '}') {
      if (open.pop()) scopes.pop()
      prelude = ''
    } else if (char === ';') {
      prelude = ''
    } else prelude += char
  }
  return keys
}

/** The one literal kept: a mask reads only the alpha of its colour, so it puts nothing on screen. */
const ringMask =
  'mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 8px));'

/** A colour written out: hex, a colour function, or one of the everyday colour names. */
const colourLiteral =
  /#[0-9a-f]{3,8}\b|(?<![-\w])(?:(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?:black|white|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver)(?![-\w]))/i

/**
 * The declarations after the first block, the `:root` tokens, that write a colour out, each as
 * `line: value`. Only declaration values are read, so a selector or a property name is never one.
 */
function colourLiterals(source: string): string[] {
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(ringMask, '')
  const afterTokens = text.indexOf('}') + 1
  return [...text.matchAll(/:([^:;{}]*)(?=[;}])/g)]
    .filter((match) => match.index >= afterTokens && colourLiteral.test(match[1] ?? ''))
    .map((match) => {
      const line = text.slice(0, match.index).split('\n').length
      return `${line}: ${(match[1] ?? '').trim().replace(/\s+/g, ' ')}`
    })
}

describe('the stylesheet', () => {
  it('takes every colour after the tokens from a token', () => {
    expect(colourLiterals(css)).toEqual([])
  })

  it('knows a colour written out from a token, a selector and the ring’s mask', () => {
    const found = (rules: string) => colourLiterals(`:root {\n  --a: #fff;\n}\n${rules}`)
    for (const value of [
      '#fff',
      '#0008',
      '1px solid #6A2A3A',
      'rgb(0 0 0 / 55%)',
      'rgba(0, 0, 0, 0.55)',
      'hsl(0 0% 0%)',
      'oklch(70% 0.1 200)',
      'white',
      'var(--a, #ff8a9b)',
      '0 0 0 2px var(--a),\n    0 0 0 3px black',
    ]) {
      expect(found(`.x {\n  color: ${value};\n}`)).toHaveLength(1)
    }
    expect(found('.x { color: red }')).toEqual(['4: red'])
    expect(
      found(
        `#add:hover .red { white-space: nowrap; color: var(--white); /* #fff */ }\n.y {\n  ${ringMask}\n}`,
      ),
    ).toEqual([])
  })

  it('defines no selector twice in the same scope', () => {
    const seen = new Set<string>()
    const twice = ruleKeys(css).filter((key) => (seen.has(key) ? true : (seen.add(key), false)))
    expect(twice).toEqual([])
  })

  it('has one named section per feature at its end, where new rules go there', () => {
    const banners = [...css.matchAll(/^\/\* ===== (.+) ===== \*\/$/gm)].map((match) => match[1])
    expect(banners).toEqual(['Narration', 'Music', 'Images', 'Sound effects', 'Scenes', 'Setup'])
  })
})
