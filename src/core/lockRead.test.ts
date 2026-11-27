import { expect, test } from 'bun:test'
import { chosenOf, LOCK_UNREAD, lockEntry, type LockRead } from './lockRead'

const read: LockRead<number> = { read: true, entries: { a: 1 } }

test('an unreadable lock says nothing is known, whatever the id', () => {
  expect(lockEntry(LOCK_UNREAD, 'a')).toEqual({ standing: 'unknown' })
})

test('a readable lock without the id says not chosen', () => {
  expect(lockEntry(read, 'b')).toEqual({ standing: 'not-chosen' })
})

test('a readable lock with the id says chosen, with its entry', () => {
  expect(lockEntry(read, 'a')).toEqual({ standing: 'chosen', entry: 1 })
})

test('what is chosen carries the take, or that there is none, once the lock is read', () => {
  expect(chosenOf(true, 3)).toEqual({ known: true, take: 3 })
  expect(chosenOf(true, null)).toEqual({ known: true, take: null })
})

test('what is chosen is not known while the lock is unread, with no take to read', () => {
  const chosen = chosenOf(false, 3)
  expect(chosen).toEqual({ known: false })
  // @ts-expect-error: there is no take until `known` has been asked.
  expect(chosen.take).toBeUndefined()
})
