import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BIRDS, MAX_COUNT, STORAGE_KEY, emptyTally, load, save, step, total } from './tally.js'

const memoryStorage = (initial = {}) => {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    items,
  }
}

test('an empty tally counts every bird at zero', () => {
  const tally = emptyTally()
  assert.deepEqual(Object.keys(tally), BIRDS.map((bird) => bird.id))
  assert.equal(total(tally), 0)
})

test('a step changes one bird and stays between zero and the ceiling', () => {
  let tally = step(emptyTally(), 'mallard', 1)
  assert.equal(tally.mallard, 1)
  assert.equal(total(tally), 1)
  tally = step(tally, 'mallard', -5)
  assert.equal(tally.mallard, 0)
  tally = step({ ...tally, mallard: MAX_COUNT }, 'mallard', 1)
  assert.equal(tally.mallard, MAX_COUNT)
})

test('a bird the tally does not offer is not added', () => {
  const tally = emptyTally()
  assert.equal(step(tally, 'dodo', 1), tally)
  assert.equal(step(tally, 'constructor', 1), tally)
})

test('what was saved is what loads', () => {
  const storage = memoryStorage()
  const tally = step(step(emptyTally(), 'kingfisher', 1), 'kingfisher', 1)
  assert.equal(save(storage, tally), true)
  assert.deepEqual(load(storage), tally)
})

test('a stored tally is checked, not trusted', () => {
  const stored = { mallard: 3, kingfisher: -1, 'grey-heron': 1.5, 'common-tern': '7', dodo: 4, 'black-headed-gull': MAX_COUNT + 1 }
  const tally = load(memoryStorage({ [STORAGE_KEY]: JSON.stringify(stored) }))
  assert.deepEqual(tally, { ...emptyTally(), mallard: 3 })
  for (const junk of ['not json', 'null', '[1,2]', '42']) {
    assert.deepEqual(load(memoryStorage({ [STORAGE_KEY]: junk })), emptyTally(), junk)
  }
})

test('a browser that refuses to keep the tally is reported, not thrown', () => {
  const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.equal(save(refusing, emptyTally()), false)
})

test('a browser with no storage at all gets an empty tally that is not kept', () => {
  assert.deepEqual(load(null), emptyTally())
  assert.equal(save(null, emptyTally()), false)
})
