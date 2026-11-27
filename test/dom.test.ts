import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { unregisterDom } from './dom'

describe('taking a DOM down', () => {
  it('renders what React had scheduled while there is still a window', async () => {
    GlobalRegistrator.register()
    const { createElement, useState } = await import('react')
    const { flushSync } = await import('react-dom')
    const { createRoot } = await import('react-dom/client')
    const rendered: string[] = []
    let change = (_: string) => {}
    function Said() {
      const [said, setSaid] = useState('first')
      change = setSaid
      rendered.push(`${said} ${typeof window}`)
      return null
    }
    const root = createRoot(document.createElement('div'))
    flushSync(() => root.render(createElement(Said)))
    // As TanStack Query tells its observers: from a timer, after the test has moved on.
    setTimeout(() => change('later'), 0)

    await unregisterDom()

    expect(rendered).toEqual(['first object', 'later object'])
    expect(typeof window).toBe('undefined')
  })

  it('is how every test file takes its DOM down', () => {
    const repo = join(import.meta.dir, '..')
    const direct = [...new Bun.Glob('{src,test,scripts}/**/*.test.{ts,tsx}').scanSync(repo)].filter(
      (file) =>
        file !== 'test/dom.test.ts' &&
        readFileSync(join(repo, file), 'utf8').includes('GlobalRegistrator.unregister'),
    )
    expect(direct).toEqual([])
  })
})
