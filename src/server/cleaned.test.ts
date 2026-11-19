import { describe, expect, it } from 'bun:test'
import { startBase } from './test-support'

const { url } = startBase()

describe('the cleaned copies', () => {
  const ask = (body: unknown, origin?: string) =>
    fetch(url('/api/cleaned'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: origin ?? url('/').origin },
      body: JSON.stringify(body),
    })

  it('are asked for from the studio’s own page only, with a clip or a take', async () => {
    expect((await ask({ part: 'act1', file: 'a.mp3' }, 'http://evil.test')).status).toBe(403)
    expect((await ask({ nothing: true })).status).toBe(400)
    expect((await ask({ take: 'not-a-key' })).status).toBe(400)
    expect((await ask({ part: 'act1', file: 'gone.mp3' })).status).toBe(404)
    expect((await ask({ take: 'a'.repeat(16) })).status).toBe(404)
  })

  it('say why a copy could not be made, as given', async () => {
    // The sample clip is not audio, so decoding it fails whatever ffmpeg says.
    const answer = await (await ask({ part: 'act1', file: 'a.mp3' })).json()
    expect(answer.ok).toBe(false)
    expect(answer.message).toContain('ffmpeg')
  })

  it('serve a copy by its name only', async () => {
    expect((await fetch(url('/api/cleaned/' + 'd'.repeat(16) + '.mp3'))).status).toBe(404)
    expect((await fetch(url('/api/cleaned/..%2F..%2Fcontent-studio.json'))).status).toBe(404)
  })
})
