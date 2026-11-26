import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ERRORS,
  MAX_EXPENSES,
  MAX_NAME,
  MAX_PEOPLE,
  STORAGE_KEY,
  addExpense,
  addPerson,
  emptyBill,
  load,
  removeExpense,
  removePerson,
  save,
} from './bill.js'

const memoryStorage = (initial = {}) => {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    items,
  }
}

/** A change that must succeed: its bill, or a failure that names the error. */
const ok = ({ bill, error }) => {
  assert.equal(error, undefined)
  return bill
}

const threeFriends = () => ['Ann', 'Ben', 'Cleo'].reduce((bill, name) => ok(addPerson(bill, name)), emptyBill())

test('people get ids of their own and names without stray spaces', () => {
  const bill = ok(addPerson(ok(addPerson(emptyBill(), '  Ann ')), 'Ben   Smith'))
  assert.deepEqual(bill.people, [
    { id: 'p1', name: 'Ann' },
    { id: 'p2', name: 'Ben Smith' },
  ])
})

test('an empty, too long or repeated name, or one person too many, is refused', () => {
  assert.equal(addPerson(emptyBill(), '   ').error, ERRORS.name)
  assert.equal(addPerson(emptyBill(), 'x'.repeat(MAX_NAME + 1)).error, ERRORS.name)
  assert.equal(addPerson(threeFriends(), 'ann').error, ERRORS.duplicate)
  let bill = emptyBill()
  for (let i = 0; i < MAX_PEOPLE; i += 1) bill = ok(addPerson(bill, `Person ${i}`))
  assert.equal(addPerson(bill, 'One more').error, ERRORS.people)
})

test('an expense is split among the chosen people, in the order of the group', () => {
  const bill = ok(addExpense(threeFriends(), { title: 'Pizza', amount: '30.00', paidBy: 'p1', among: ['p3', 'p1'] }))
  assert.deepEqual(bill.expenses, [{ id: 'e1', title: 'Pizza', amount: 3000, paidBy: 'p1', among: ['p1', 'p3'] }])
})

test('an expense with a bad amount, no payer or nobody to split among is refused', () => {
  const group = threeFriends()
  const good = { title: 'Taxi', amount: '12.40', paidBy: 'p2', among: ['p1', 'p2'] }
  assert.equal(addExpense(group, { ...good, amount: '-12.40' }).error, ERRORS.amount)
  assert.equal(addExpense(group, { ...good, amount: '0' }).error, ERRORS.amount)
  assert.equal(addExpense(group, { ...good, title: '' }).error, ERRORS.title)
  assert.equal(addExpense(group, { ...good, paidBy: 'p9' }).error, ERRORS.paidBy)
  assert.equal(addExpense(group, { ...good, among: [] }).error, ERRORS.among)
  assert.equal(addExpense(group, { ...good, among: ['p9'] }).error, ERRORS.among)
  assert.equal(addExpense(emptyBill(), { ...good, paidBy: 'p1', among: ['p1'] }).error, ERRORS.paidBy)
  let bill = group
  for (let i = 0; i < MAX_EXPENSES; i += 1) bill = ok(addExpense(bill, good))
  assert.equal(addExpense(bill, good).error, ERRORS.expenses)
})

test('someone in an expense stays until it is removed', () => {
  const bill = ok(addExpense(threeFriends(), { title: 'Taxi', amount: '9', paidBy: 'p1', among: ['p2'] }))
  assert.equal(removePerson(bill, 'p1').error, ERRORS.inUse)
  assert.equal(removePerson(bill, 'p2').error, ERRORS.inUse)
  assert.deepEqual(ok(removePerson(bill, 'p3')).people.map((p) => p.id), ['p1', 'p2'])
  const without = ok(removeExpense(bill, 'e1'))
  assert.deepEqual(ok(removePerson(without, 'p1')).people.map((p) => p.id), ['p2', 'p3'])
})

test('an id is never handed out twice, after a removal either', () => {
  const bill = ok(removePerson(threeFriends(), 'p3'))
  assert.equal(ok(addPerson(ok(removePerson(bill, 'p1')), 'Dan')).people.at(-1).id, 'p3')
})

test('what was saved is what loads', () => {
  const storage = memoryStorage()
  const bill = ok(addExpense(threeFriends(), { title: 'Groceries', amount: '45.10', paidBy: 'p3', among: ['p1', 'p2', 'p3'] }))
  assert.equal(save(storage, bill), true)
  assert.deepEqual(load(storage), bill)
})

test('a stored bill is checked, not trusted', () => {
  const stored = {
    people: [
      { id: 'p1', name: 'Ann' },
      { id: 'p1', name: 'Ann again' },
      { id: 'p2', name: '' },
      { id: 'x3', name: 'Cleo' },
      { id: 'p4', name: 'x'.repeat(MAX_NAME + 1) },
      { id: 'p5', name: 42 },
      { id: 'p6', name: 'Ben' },
      null,
    ],
    expenses: [
      { id: 'e1', title: 'Fine', amount: 1000, paidBy: 'p1', among: ['p1', 'p6'] },
      { id: 'e2', title: 'Negative', amount: -1000, paidBy: 'p1', among: ['p1'] },
      { id: 'e3', title: 'Float', amount: 10.5, paidBy: 'p1', among: ['p1'] },
      { id: 'e4', title: 'Nobody', amount: 1000, paidBy: 'p1', among: [] },
      { id: 'e5', title: 'Stranger', amount: 1000, paidBy: 'p2', among: ['p1'] },
      { id: 'e6', title: 'Twice', amount: 1000, paidBy: 'p1', among: ['p1', 'p1'] },
      { id: 'e7', title: 'As text', amount: '1000', paidBy: 'p1', among: ['p1'] },
      { id: 'e1', title: 'Same id', amount: 1000, paidBy: 'p1', among: ['p1'] },
    ],
  }
  const bill = load(memoryStorage({ [STORAGE_KEY]: JSON.stringify(stored) }))
  assert.deepEqual(bill, {
    people: [
      { id: 'p1', name: 'Ann' },
      { id: 'p6', name: 'Ben' },
    ],
    expenses: [{ id: 'e1', title: 'Fine', amount: 1000, paidBy: 'p1', among: ['p1', 'p6'] }],
  })
  for (const junk of ['not json', 'null', '[1,2]', '42', '{"people":"Ann"}']) {
    assert.deepEqual(load(memoryStorage({ [STORAGE_KEY]: junk })), emptyBill(), junk)
  }
})

test('a browser that refuses to keep the bill is reported, not thrown', () => {
  const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.equal(save(refusing, emptyBill()), false)
})

test('a browser with no storage at all gets an empty bill that is not kept', () => {
  assert.deepEqual(load(null), emptyBill())
  assert.equal(save(null, emptyBill()), false)
})
