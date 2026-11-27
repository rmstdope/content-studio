import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import {
  formatEntriesPerLine,
  isWriteFailure,
  listFiles,
  readJson,
  refusalAnswer,
  refusalFailed,
  refusalProblems,
  writeFailure,
  writeOrRefuse,
  WriteRefused,
  writeTogether,
  refusalSentence,
} from './files'

describe('formatEntriesPerLine', () => {
  it('writes one sorted entry per line, as valid JSON', () => {
    const text = formatEntriesPerLine({ b: { x: 1 }, a: { y: [1, 2] } })
    expect(text).toBe('{\n "a": {"y":[1,2]},\n "b": {"x":1}\n}\n')
    expect(JSON.parse(text)).toEqual({ a: { y: [1, 2] }, b: { x: 1 } })
  })

  it('writes an empty object on one line', () => {
    expect(formatEntriesPerLine({})).toBe('{}\n')
  })
})

describe('writeOrRefuse', () => {
  it('creates the folder, writes the file and leaves no temporary file', async () => {
    const root = tempRepo({})
    await writeOrRefuse(root, 'content-studio/narration/act1.lock.json', '{}\n')
    expect(readFileSync(join(root, 'content-studio/narration/act1.lock.json'), 'utf8')).toBe('{}\n')
    expect(readdirSync(join(root, 'content-studio/narration'))).toEqual(['act1.lock.json'])
  })

  it('refuses to write outside the root', async () => {
    const root = tempRepo({})
    const error = await writeOrRefuse(root, '../escape.json', '{}').catch((e) => e)
    expect(error.reason).toContain('outside')
  })
})

describe('listFiles', () => {
  it('lists the files of a folder, and nothing for a folder that does not exist', async () => {
    const root = tempRepo({ 'clips/a.mp3': 'x', 'clips/sub/b.mp3': 'y' })
    expect(await listFiles(join(root, 'clips'))).toEqual(new Set(['a.mp3']))
    expect(await listFiles(join(root, 'nowhere'))).toEqual(new Set())
  })
})

describe('writeOrRefuse, twice at once', () => {
  it('leaves one complete write and no temporary files', async () => {
    const root = tempRepo({})
    const a = 'a'.repeat(200_000)
    const b = 'b'.repeat(200_000)
    await Promise.all([writeOrRefuse(root, 'x.json', a), writeOrRefuse(root, 'x.json', b)])
    expect([a, b]).toContain(readFileSync(join(root, 'x.json'), 'utf8'))
    expect(readdirSync(root)).toEqual(['x.json'])
  })
})

describe('writeOrRefuse, when the write fails', () => {
  it('refuses and leaves no temporary file', async () => {
    const root = tempRepo({ 'taken/x': 'a folder where the file should go' })
    await expect(writeOrRefuse(root, 'taken', '{}')).rejects.toBeInstanceOf(WriteRefused)
    expect(readdirSync(root)).toEqual(['taken'])
  })
})

describe('readJson, unreadable', () => {
  it('reports a path that is a folder as invalid, not as a crash', async () => {
    const root = tempRepo({ 'folder/x': 'x' })
    const read = await readJson(join(root, 'folder'))
    expect(read.status).toBe('invalid')
  })
})

describe('writeFailure', () => {
  const failed = (code: string) => Object.assign(new Error(`${code}: open 'x.tmp'`), { code })

  it('names the cause a user can act on, not the call that met it', () => {
    expect(writeFailure(failed('EACCES'))).toBe('permission denied')
    expect(writeFailure(failed('EPERM'))).toBe('permission denied')
    expect(writeFailure(failed('EROFS'))).toBe('the disk is read-only')
    expect(writeFailure(failed('ENOSPC'))).toBe('the disk is full')
    expect(writeFailure(failed('EDQUOT'))).toBe('the disk quota is used up')
  })

  it('gives an unknown error’s own message', () => {
    expect(writeFailure(failed('EIO'))).toBe("EIO: open 'x.tmp'")
    expect(writeFailure(failed('toString'))).toBe("toString: open 'x.tmp'")
  })
})

describe('isWriteFailure', () => {
  const failed = (code: string) => Object.assign(new Error(`${code}: open 'x.tmp'`), { code })

  it('knows the refusals writeFailure names, and nothing else', () => {
    for (const code of ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT']) {
      expect(isWriteFailure(failed(code))).toBe(true)
    }
    expect(isWriteFailure(failed('EIO'))).toBe(false)
    expect(isWriteFailure(failed('toString'))).toBe(false)
    expect(isWriteFailure(new Error('no code'))).toBe(false)
    expect(isWriteFailure(null)).toBe(false)
  })
})

describe('writeOrRefuse', () => {
  it('refuses a write that fails with the file named and the reason kept', async () => {
    const root = tempRepo({ blocked: 'a file, not a folder' })
    const error = await writeOrRefuse(root, 'blocked/board.json', '{}').catch((e) => e)
    expect(error).toBeInstanceOf(WriteRefused)
    expect(error.file).toBe('blocked/board.json')
    expect(error.reason).toBeString()
    expect(refusalSentence(error)).toBe('blocked/board.json could not be written')
  })

  it('writes the file when nothing is wrong', async () => {
    const root = tempRepo({})
    await writeOrRefuse(root, 'a/b.json', '{}')
    expect(readFileSync(join(root, 'a/b.json'), 'utf8')).toBe('{}')
  })

  it('has no sentence for an error that is not a refused write', () => {
    expect(refusalSentence(new Error('boom'))).toBeNull()
  })
})

describe('writeTogether', () => {
  it('puts back what it wrote when a later write is refused, and names the file', async () => {
    const root = tempRepo({ 'a.txt': 'old', blocked: 'a file, not a folder' })
    expect(
      await writeTogether(root, [
        ['a.txt', 'new'],
        ['b.txt', 'new'],
        ['blocked/c.txt', 'new'],
      ]),
    ).toEqual({ ok: false, message: 'blocked/c.txt could not be written.' })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old')
    expect(existsSync(join(root, 'b.txt'))).toBe(false)
  })

  it('says so when what it wrote cannot be put back', async () => {
    const root = tempRepo({ 'a.txt': 'old', blocked: 'a file, not a folder' })
    const write = async (at: string, path: string, text: string | Uint8Array) => {
      if (typeof text !== 'string') throw new WriteRefused(path, 'permission denied', null)
      await writeOrRefuse(at, path, text)
    }
    expect(
      await writeTogether(
        root,
        [
          ['a.txt', 'new'],
          ['blocked/c.txt', 'new'],
        ],
        write,
      ),
    ).toEqual({
      ok: false,
      message: "blocked/c.txt could not be written, and the game's files could not be put back.",
    })
  })

  it.skipIf(process.getuid?.() === 0)(
    'refuses a file it cannot read before writing it, so it is never removed',
    async () => {
      const root = tempRepo({ 'a.txt': 'old', blocked: 'a file, not a folder' })
      chmodSync(join(root, 'a.txt'), 0o200)
      try {
        expect(
          await writeTogether(root, [
            ['a.txt', 'new'],
            ['blocked/c.txt', 'new'],
          ]),
        ).toEqual({ ok: false, message: 'a.txt could not be written.' })
      } finally {
        chmodSync(join(root, 'a.txt'), 0o644)
      }
      expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('old')
    },
  )
})

describe('the answers to a refused write', () => {
  const refused = new WriteRefused('content-studio/b.json', 'permission denied', null)
  /** `answer` for the refusal, and what it logged. */
  function answered<T>(answer: (error: unknown) => T) {
    const logged: unknown[][] = []
    const quiet = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    try {
      return { answer: answer(refused), logged }
    } finally {
      console.error = quiet
    }
  }

  it('as a message: names the file, and keeps the refusal with its reason in the log', () => {
    const { answer, logged } = answered(refusalAnswer('saving failed', (s) => `${s}.`))
    expect(answer).toEqual({ ok: false, message: 'content-studio/b.json could not be written.' })
    expect(logged).toEqual([['saving failed', refused]])
  })

  it('as problems: the reason at the file, at the path given', () => {
    const { answer, logged } = answered(refusalProblems('saving failed', 'style'))
    expect(answer).toEqual({
      ok: false,
      problems: [{ file: 'content-studio/b.json', path: 'style', message: 'permission denied' }],
    })
    expect(logged).toEqual([['saving failed', refused]])
  })

  it('as failed: the reason, with the file', () => {
    const { answer, logged } = answered(refusalFailed('saving failed'))
    expect(answer).toEqual({
      ok: false,
      kind: 'failed',
      file: 'content-studio/b.json',
      message: 'permission denied',
    })
    expect(logged).toEqual([['saving failed', refused]])
  })

  it('lets any other error go on', () => {
    for (const answer of [refusalAnswer('x', (s) => s), refusalProblems('x'), refusalFailed('x')]) {
      expect(() => answer(new Error('boom'))).toThrow('boom')
    }
  })
})
