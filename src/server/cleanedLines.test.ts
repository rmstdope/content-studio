import { describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
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
const post = (path: string) =>
  fetch(url(path), { method: 'POST', headers: { origin: url('/').origin } })

describe('the lines cleaned in the game', () => {
  it('are counted for a voice, with the job that is running or last ran', async () => {
    const answer = await (await fetch(url('/api/characters/narrator/cleaned-lines'))).json()
    expect(answer).toEqual({
      total: 1,
      cleaned: 0,
      problem: null,
      cleanedFiles: [],
      job: null,
      levels: [{ part: 'act1', file: 'a.mp3', level: 100 }],
      levelJob: null,
    })
  })

  it('refuse a put back with nothing cleaned, and a stop with nothing running', async () => {
    const putBack = await post('/api/characters/narrator/cleaned-lines/put-back')
    expect(putBack.status).toBe(409)
    expect(await putBack.json()).toEqual({ error: 'There are no lines to put back.' })
    expect((await post('/api/characters/narrator/cleaned-lines/stop')).status).toBe(404)
  })

  it('refuse to clean a voice that is switched off', async () => {
    const answer = await post('/api/characters/narrator/cleaned-lines/clean')
    expect(answer.status).toBe(409)
    expect(await answer.json()).toEqual({ error: 'The clean-up is switched off for this voice.' })
  })

  it('say why a line could not be cleaned, naming the line and no file', async () => {
    writeFileSync(cast, JSON.stringify({ speakers: { narrator: { voice: 'v1', clean: true } } }))
    // The sample clip is not audio, so decoding it fails whatever ffmpeg says.
    expect((await post('/api/characters/narrator/cleaned-lines/clean')).status).toBe(200)
    let job = null
    for (let i = 0; i < 100 && job?.status !== 'done'; i++) {
      await Bun.sleep(20)
      job = (await (await fetch(url('/api/characters/narrator/cleaned-lines'))).json()).job
    }
    expect(job.failed).toHaveLength(1)
    expect(job.failed[0]).toMatchObject({ part: 'act1', key: 'a' })
    expect(job.failed[0].message).toStartWith('Line a: ')
    expect(job.failed[0].message).not.toContain('.mp3')
  })

  it('serve an original only for a line that is cleaned', async () => {
    expect((await fetch(url('/api/parts/act1/originals/a.mp3'))).status).toBe(404)
    expect((await fetch(url('/api/parts/act1/originals/..%2Fcast.json'))).status).toBe(404)
  })
})
