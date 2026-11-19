import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dir, '..', 'docs', 'ui')

/** Every design mockup must open styled: no `<style` may sit inside another `<style>` element. */
test('no mockup nests a <style> inside its <style> element', () => {
  const nested: string[] = []
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(dir, name), 'utf8')
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      if (/<style\b/i.test(m[1]!)) nested.push(name)
    }
  }
  expect(nested).toEqual([])
})
