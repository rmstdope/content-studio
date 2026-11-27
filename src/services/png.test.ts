import { describe, expect, it } from 'bun:test'
import { deflateSync, inflateSync } from 'node:zlib'
import { decodePng, encodePng, encodeTransparentPng, pngSize } from './png'
import type { Pixels } from '../core/imagePixels'

const gradient = (w: number, h: number): Pixels => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set([x * 7 + y, y * 5, (x * y) % 256, 255], (y * w + x) * 4)
  }
  return { width: w, height: h, data }
}

/** One chunk as `decodePng` reads it; it checks no CRC, so the four bytes stay zero. */
const chunk = (type: string, data: number[]) => {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  return out
}

/** A PNG of colour `type` holding `rows` of samples, every row written with `filter`. */
function pngOf(type: number, channels: number, rows: number[][], filter: number, plte?: number[]) {
  const raw: number[] = []
  rows.forEach((row, y) => {
    raw.push(filter)
    row.forEach((value, i) => {
      const left = i >= channels ? row[i - channels]! : 0
      const up = rows[y - 1]?.[i] ?? 0
      const upLeft = i >= channels ? (rows[y - 1]?.[i - channels] ?? 0) : 0
      const p = left + up - upLeft
      const near = [left, up, upLeft].map((v) => Math.abs(p - v))
      const paeth =
        near[0]! <= near[1]! && near[0]! <= near[2]! ? left : near[1]! <= near[2]! ? up : upLeft
      const guess = [0, left, up, (left + up) >> 1, paeth][filter] ?? 0
      raw.push((value - guess) & 255)
    })
  })
  const width = rows[0]!.length / channels
  const header = [0, 0, 0, width, 0, 0, 0, rows.length, 8, type, 0, 0, 0]
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', header),
    ...(plte ? [chunk('PLTE', plte)] : []),
    chunk('IDAT', [...deflateSync(Uint8Array.from(raw))]),
    chunk('IEND', []),
  ]
  return Uint8Array.from(parts.flatMap((part) => [...part]))
}

/** Rows of samples that differ enough for every filter to wrap past 0 and 255. */
const samples = (channels: number, limit = 256) =>
  Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 6 * channels }, (_, i) => (i * i * 37 + y * 101 + i * y * 13) % limit),
  )

describe('decoding every colour type under every filter', () => {
  const palette = [10, 20, 30, 40, 50, 60, 70, 80, 90]
  /** Each colour type with its samples per pixel and the RGBA one pixel's samples stand for. */
  const types: [string, number, number, (s: number[]) => number[]][] = [
    ['grey', 0, 1, ([v]) => [v!, v!, v!, 255]],
    ['RGB', 2, 3, ([r, g, b]) => [r!, g!, b!, 255]],
    ['palette', 3, 1, ([n]) => [...[0, 1, 2].map((c) => palette[n! * 3 + c] ?? 0), 255]],
    ['grey with alpha', 4, 2, ([v, a]) => [v!, v!, v!, a!]],
    ['RGBA', 6, 4, (s) => s],
  ]
  for (const [name, type, channels, rgba] of types) {
    for (const filter of [0, 1, 2, 3, 4]) {
      it(`reads ${name} written with filter ${filter}`, () => {
        // A palette index past the three colours given reads as black.
        const rows = samples(channels, type === 3 ? 4 : 256)
        const png = pngOf(type, channels, rows, filter, type === 3 ? palette : undefined)
        const expected = rows.flatMap((row) =>
          Array.from({ length: 6 }, (_, x) =>
            rgba(row.slice(x * channels, (x + 1) * channels)),
          ).flat(),
        )
        const back = decodePng(png)
        expect([back.width, back.height]).toEqual([6, 5])
        expect([...back.data]).toEqual(expected)
      })
    }
  }
  it('refuses a filter it does not know', () => {
    expect(() => decodePng(pngOf(2, 3, samples(3), 5))).toThrow('a filter the studio does not know')
  })
  it('refuses a picture with rows missing', () => {
    const png = pngOf(2, 3, samples(3), 0)
    png[23] = 9 // the header's height, more rows than the data holds
    expect(() => decodePng(png)).toThrow('cut short')
  })
})

describe('png', () => {
  it('round-trips the pixels', () => {
    const picture = gradient(37, 19)
    const back = decodePng(encodePng(picture))
    expect([back.width, back.height]).toEqual([37, 19])
    expect(back.data).toEqual(picture.data)
  })
  it('reads the size from the start of the file', () => {
    expect(pngSize(encodePng(gradient(37, 19)).subarray(0, 33))).toEqual({ width: 37, height: 19 })
  })
  it('says a file is not a PNG when asked its size', () => {
    expect(() => pngSize(new TextEncoder().encode('not a picture'))).toThrow('not a PNG')
  })
  it('keeps the transparency of a picture written with it', () => {
    const picture = gradient(9, 5)
    picture.data[3] = 0
    picture.data[7] = 128
    const png = encodeTransparentPng(picture)
    expect(png[25]).toBe(6) // the colour type of RGBA
    const length = new DataView(png.buffer, png.byteOffset).getUint32(33)
    const raw = inflateSync(png.subarray(41, 41 + length))
    expect([raw[4], raw[8], raw[12]]).toEqual([0, 128, 255])
  })
  it('reads the transparency back from a picture written with it', () => {
    const picture = gradient(9, 5)
    picture.data[3] = 0
    picture.data[7] = 128
    const back = decodePng(encodeTransparentPng(picture))
    expect([back.data[3], back.data[7], back.data[11]]).toEqual([0, 128, 255])
    expect(decodePng(encodePng(picture)).data[3]).toBe(255)
  })
  it('reads what other encoders write: RGBA with filters, and a palette picture', async () => {
    const source = encodePng(gradient(40, 30))
    const filtered = await new Bun.Image(source).resize(20, 15).png().bytes()
    const rgba = decodePng(filtered)
    expect([rgba.width, rgba.height]).toEqual([20, 15])
    const indexed = await new Bun.Image(source).png({ palette: true }).bytes()
    const palette = decodePng(indexed)
    expect([palette.width, palette.height]).toEqual([40, 30])
    for (let i = 3; i < palette.data.length; i += 4) expect(palette.data[i]).toBe(255)
  })
  it('says what is wrong with something that is not a usable png', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('not a PNG')
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => decodePng(jpeg)).toThrow('not a PNG')
  })
})
