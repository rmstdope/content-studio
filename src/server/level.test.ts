import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startBase } from './test-support'

const { url, root } = startBase()
writeFileSync(
  join(root, 'content-studio/narration/act1.lock.json'),
  JSON.stringify({
    a: {
      fp: 'f',
      voice: 'v1',
      model: 's2',
      hashes: { cue: 'c', text: 't', said: 's', settings: 'x' },
      at: 'T1',
    },
  }),
)
const cast = join(root, 'content-studio/narration/cast.json')
const post = (character: string, body: unknown, origin: string = url('/').origin) =>
  fetch(url(`/api/characters/${character}/level`), {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('a voice’s level', () => {
  it('is set from the studio’s own page only, to a whole number from 10 to 200', async () => {
    expect((await post('narrator', { level: 60 }, 'http://evil.test')).status).toBe(403)
    for (const level of [5, 201, 60.5, '60', null]) {
      expect((await post('narrator', { level })).status).toBe(400)
    }
    expect((await post('narrator', { level: 60, extra: 1 })).status).toBe(400)
  })

  it('knows no character it was not told of', async () => {
    expect((await post('nobody', { level: 60 })).status).toBe(404)
  })

  it('is saved at once for a voice with no lines in the game, and starts no job', async () => {
    writeFileSync(
      cast,
      JSON.stringify({ speakers: { narrator: { voice: 'v1' }, ghost: { voice: 'v9' } } }),
    )
    const answer = await post('ghost', { level: 60 })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true, job: null })
    expect(JSON.parse(readFileSync(cast, 'utf8')).speakers.ghost.level).toBe(60)
  })

  it('is saved, then set on the lines in the game by a job that says why a line failed', async () => {
    const answer = await post('narrator', { level: 60 })
    expect(answer.status).toBe(200)
    const body = await answer.json()
    expect(body).toMatchObject({ ok: true, job: { level: 60, total: 1, status: 'running' } })
    expect(JSON.parse(readFileSync(cast, 'utf8')).speakers.narrator.level).toBe(60)
    let job = null
    for (let i = 0; i < 100 && job?.status !== 'done'; i++) {
      await Bun.sleep(20)
      job = (await (await fetch(url('/api/characters/narrator/cleaned-lines'))).json()).levelJob
    }
    // The sample clip is not audio, so setting it fails whatever ffmpeg says.
    expect(job.failed).toHaveLength(1)
    expect(job.failed[0]).toMatchObject({ part: 'act1', key: 'a' })
    const lines = (await (await fetch(url('/api/characters/narrator/cleaned-lines'))).json()).levels
    expect(lines).toEqual([{ part: 'act1', file: 'a.mp3', level: 100 }])
  })
})
