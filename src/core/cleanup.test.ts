import { describe, expect, it } from 'bun:test'
import { cleanupFilter, quietestStretch, withNoiseFirst } from './cleanup'
import type { Wav } from './wav'

/** 16-bit mono PCM at 1000 Hz from one level per tenth of a second (constant samples). */
function take(levels: number[]): Wav {
  const data = new Uint8Array(levels.length * 100 * 2)
  const view = new DataView(data.buffer)
  levels.forEach((level, tenth) => {
    for (let i = 0; i < 100; i++) view.setInt16((tenth * 100 + i) * 2, level, true)
  })
  return { format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 }, data }
}

describe('quietestStretch', () => {
  it('finds where a take is quietest, and how loud that is', () => {
    const wav = take([8000, 8000, 300, 300, 300, 300, 300, 8000, 8000])
    const floor = quietestStretch(wav, 0.4)!
    expect(floor.start).toBeGreaterThanOrEqual(0.2)
    expect(floor.start).toBeLessThanOrEqual(0.3)
    expect(floor.db).toBeCloseTo(20 * Math.log10(300 / 32768), 1)
  })

  it('gives silence a floor of −120 dBFS', () => {
    expect(quietestStretch(take([0, 0, 0, 0, 0]), 0.4)!.db).toBe(-120)
  })

  it('has no floor for a take shorter than the stretch, or not 16-bit', () => {
    expect(quietestStretch(take([100, 100]), 0.4)).toBeNull()
    const wav = take([100, 100, 100, 100, 100])
    expect(
      quietestStretch({ ...wav, format: { ...wav.format, bitsPerSample: 24 } }, 0.4),
    ).toBeNull()
  })
})

describe('cleanupFilter', () => {
  it('is the chosen chain: 80 Hz high-pass, noise print from the quiet stretch, a gate 12 dB over the floor lowering by 10 dB', () => {
    const chain = cleanupFilter({ db: -40 })
    expect(chain).toStartWith('highpass=f=80,asendcmd=c=')
    expect(chain).toContain('0 afftdn sn start')
    expect(chain).toContain('0.400000 afftdn sn stop')
    expect(chain).toEndWith('atrim=start=0.400000,asetpts=PTS-STARTPTS')
    expect(chain).toContain('afftdn=nr=20')
    const gate = /agate=threshold=([\d.]+):range=([\d.]+)/.exec(chain)!
    expect(20 * Math.log10(Number(gate[1]))).toBeCloseTo(-28, 1)
    expect(20 * Math.log10(Number(gate[2]))).toBeCloseTo(-10, 1)
  })

  it('never opens the gate above −6 dBFS, however loud the floor', () => {
    const gate = /threshold=([\d.]+)/.exec(cleanupFilter({ db: 0 }))!
    expect(20 * Math.log10(Number(gate[1]))).toBeLessThanOrEqual(-5.9)
  })
})

describe('withNoiseFirst', () => {
  it('puts a copy of the quietest stretch in front of the take', () => {
    const wav = take([8000, 8000, 300, 300, 300, 300, 300, 8000, 8000])
    const floor = quietestStretch(wav, 0.4)!
    const joined = withNoiseFirst(wav, floor)
    expect(joined.data.length).toBe(wav.data.length + 0.4 * 1000 * 2)
    const view = new DataView(joined.data.buffer)
    expect(view.getInt16(0, true)).toBe(300)
    expect(view.getInt16(0.4 * 1000 * 2, true)).toBe(8000)
    expect(joined.data.subarray(0.4 * 1000 * 2)).toEqual(wav.data)
  })
})
