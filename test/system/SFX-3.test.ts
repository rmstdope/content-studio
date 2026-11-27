// SFX-3: Make all makes takes for every effect that has none, and can be stopped.
import { describe, expect, it } from 'bun:test'
import { planMakeAll, type EffectBatch } from '../../src/core/effectsMakeAll'
import type { EffectTakesView } from '../../src/core/effectTakes'
import type { ProjectSummary } from '../../src/core/summary'
import { createFakeEffects } from '../../src/services/effectsFake'
import { projectJson } from '../helpers'
import { startStudio, wavOf } from './studio'

const list = [
  { id: 'coins', text: 'Coins spill on stone', seconds: 3 },
  { id: 'door', text: 'A wooden door creaks', seconds: 2 },
  { id: 'thunder', text: 'Thunder rolls', seconds: 4 },
]

/**
 * The studio on a game that lists three effects, over a local model that can be made to hold every
 * take until the test lets it finish, and that stops a held take when the studio says to.
 */
function game() {
  /** What the model was asked for, in turn. */
  const asked: string[] = []
  const model = { held: false }
  /** Lets each held take finish, oldest first. */
  const waiting: (() => void)[] = []
  const { page } = startStudio(
    {
      'content-studio.json': projectJson({
        effects: {
          from: { shared: 'tts/effects.json' },
          clips: 'audio/effects',
          manifest: 'audio/effects/manifest.json',
        },
      }),
      'content-studio/narration/cast.json': { speakers: {} },
      'tts/effects.json': list,
    },
    {
      effects: {
        ...createFakeEffects(0),
        generate: async (request, signal) => {
          asked.push(request.prompt)
          if (model.held) {
            await new Promise<void>((resolve, reject) => {
              waiting.push(resolve)
              signal?.addEventListener('abort', () => reject(new Error('stopped')))
            })
          }
          return { wav: wavOf(1), seed: request.seed }
        },
      },
    },
  )

  /** Asks `path` again and again until its answer satisfies `done`. */
  async function until<T>(path: string, done: (answer: T) => boolean): Promise<T> {
    for (const giveUp = Date.now() + 4000; ;) {
      const answer = (await (await page.get(path)).json()) as T
      if (done(answer)) return answer
      if (Date.now() > giveUp) throw new Error(`${path}: ${JSON.stringify(answer)}`)
      await Bun.sleep(5)
    }
  }

  /** The effect's takes, once none is waiting or being made. */
  const takes = (id: string) =>
    until<EffectTakesView>(`/api/effects/${id}/takes`, (view) => view.making.length === 0)

  /** The effects as the Sound effects page lists them. */
  async function rows() {
    const { summary } = (await (await page.get('/api/project')).json()) as {
      summary: ProjectSummary
    }
    return summary.effects!.rows
  }

  /** The ids the page's Make all question lists, which are what its Make posts. */
  async function listed() {
    const plan = planMakeAll(await rows(), {})
    if (!plan.known) throw new Error('the page could not plan Make all')
    return plan.startable.map((row) => row.id)
  }

  /** Makes one take of an effect from its own page, and waits for it. */
  async function makeOne(id: string) {
    const made = await page.send('POST', `/api/effects/${id}/takes`, { count: 1 })
    expect(made.status).toBe(200)
    return (await takes(id)).takes
  }

  async function makeAll(ids: string[]) {
    const response = await page.send('POST', '/api/effects/make-all', { ids })
    return [response.status, await response.json()]
  }

  const batch = (done: (batch: EffectBatch) => boolean) =>
    until<EffectBatch>('/api/effects/batch', done)

  /** Waits until the model has held `count` takes in all. */
  async function held(count: number) {
    for (const giveUp = Date.now() + 4000; waiting.length < count;) {
      if (Date.now() > giveUp) throw new Error(`the model never held ${count} takes`)
      await Bun.sleep(5)
    }
  }

  return { page, asked, model, waiting, held, takes, listed, makeOne, makeAll, batch }
}

describe('SFX-3: Make all makes takes for every effect that has none', () => {
  const { asked, takes, listed, makeOne, makeAll, batch, page } = game()

  it('makes four takes for each effect without one, and none for an effect that has its take', async () => {
    // The question as it stood before coins had a take, as a tab left open would still post it.
    const stale = await listed()
    expect(stale).toEqual(['coins', 'door', 'thunder'])
    const [first] = await makeOne('coins')
    const chosen = await page.send('POST', '/api/effects/coins/choose', { file: first!.file })
    expect(await chosen.json()).toEqual({ ok: true })
    expect(await listed()).toEqual(['door', 'thunder'])
    asked.length = 0

    expect(await makeAll(stale)).toEqual([
      200,
      {
        ok: true,
        started: [
          { id: 'door', takes: 4 },
          { id: 'thunder', takes: 4 },
        ],
      },
    ])

    expect(await batch((b) => !b.running)).toEqual({
      total: 8,
      made: 8,
      stopped: 0,
      failed: [],
      running: false,
    })
    expect((await takes('door')).takes).toHaveLength(4)
    expect((await takes('thunder')).takes).toHaveLength(4)
    expect((await takes('coins')).takes).toHaveLength(1)
    expect(asked).toEqual([
      ...Array<string>(4).fill('A wooden door creaks'),
      ...Array<string>(4).fill('Thunder rolls'),
    ])
  })
})

describe('SFX-3: Make all can be stopped', () => {
  const { asked, model, waiting, held, takes, listed, makeOne, makeAll, batch, page } = game()

  it('keeps the take already made and never makes the rest', async () => {
    model.held = true
    const ids = await listed()
    expect(ids).toEqual(['coins', 'door', 'thunder'])
    expect((await makeAll(ids))[0]).toBe(200)
    // The first take finishes; the second is being made, and ten more wait.
    await held(1)
    waiting[0]!()
    await batch((b) => b.made === 1)
    await held(2)

    const stopped = await page.send('POST', '/api/effects/stop-all')

    expect([stopped.status, await stopped.json()]).toEqual([200, { ok: true, stopped: 11 }])
    expect(await (await page.get('/api/effects/making')).json()).toEqual({})
    expect(await batch((b) => !b.running)).toEqual({
      total: 12,
      made: 1,
      stopped: 11,
      failed: [],
      running: false,
    })

    // A take asked for now waits behind every stopped one, so once it is made the model has been
    // passed all of them: it was asked for the one made, the one being made, and this one.
    model.held = false
    await makeOne('thunder')
    expect(asked).toEqual(['Coins spill on stone', 'Coins spill on stone', 'Thunder rolls'])
    expect((await takes('coins')).takes).toHaveLength(1)
    expect((await takes('door')).takes).toEqual([])
    expect((await takes('thunder')).takes).toHaveLength(1)
  })
})
