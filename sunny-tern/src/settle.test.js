import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CENTS, MAX_SETTLE, balances, formatAmount, parseAmount, settle, shares } from './settle.js'

const total = (values) => [...values].reduce((sum, n) => sum + n, 0)

/** Apply transfers to balances: what is left once everyone has paid. */
function afterPaying(balance, transfers) {
  const left = new Map(balance)
  for (const { from, to, amount } of transfers) {
    assert.ok(Number.isInteger(amount) && amount > 0, `a transfer of ${amount}`)
    left.set(from, left.get(from) + amount)
    left.set(to, left.get(to) - amount)
  }
  return left
}

/** The fewest transfers, by brute force: n minus the most zero-sum groups the balances split into. */
function fewestByBruteForce(values) {
  const open = values.filter((v) => v !== 0)
  const most = (rest) => {
    if (rest.length === 0) return 0
    const [first, ...others] = rest
    let best = -Infinity
    // Every group that contains `first`: choose which of the others join it.
    for (let pick = 0; pick < 1 << others.length; pick += 1) {
      const group = [first, ...others.filter((_, i) => pick & (1 << i))]
      if (total(group) !== 0) continue
      best = Math.max(best, 1 + most(others.filter((_, i) => !(pick & (1 << i)))))
    }
    return best
  }
  return open.length - most(open)
}

test('an amount is read into whole cents', () => {
  assert.equal(parseAmount('12'), 1200)
  assert.equal(parseAmount('12.5'), 1250)
  assert.equal(parseAmount(' 12,05 '), 1205)
  assert.equal(parseAmount('0.01'), 1)
  assert.equal(parseAmount('1000000'), MAX_CENTS)
  // 0.1 + 0.2 in floating point is 0.30000000000000004; in cents it is 30.
  assert.equal(parseAmount('0.1') + parseAmount('0.2'), parseAmount('0.3'))
})

test('a negative, zero, too precise, too large or not-a-number amount is refused', () => {
  for (const text of ['-5', '-0.01', '0', '0.00', '1.005', '1000000.01', '1e3', '12.', '.5', 'abc', '', '1 000', 'Infinity', '0x10']) {
    assert.equal(parseAmount(text), null, JSON.stringify(text))
  }
})

test('an amount is written with two decimals', () => {
  assert.equal(formatAmount(1250), '12.50')
  assert.equal(formatAmount(5), '0.05')
  assert.equal(formatAmount(-1205), '-12.05')
})

test('shares are whole cents and add up to the amount', () => {
  assert.deepEqual(shares(1000, 3), [334, 333, 333])
  assert.deepEqual(shares(2, 3), [1, 1, 0])
  for (const [cents, n] of [[1, 7], [99_999, 12], [MAX_CENTS, 11]]) {
    const split = shares(cents, n)
    assert.equal(total(split), cents)
    assert.ok(Math.max(...split) - Math.min(...split) <= 1)
  }
})

test('an expense split among nobody is refused', () => {
  assert.throws(() => shares(1000, 0), RangeError)
  const people = [{ id: 'p1' }]
  assert.throws(() => balances(people, [{ amount: 1000, paidBy: 'p1', among: [] }]), RangeError)
  assert.throws(() => balances(people, [{ amount: 1000, paidBy: 'p9', among: ['p1'] }]), RangeError)
})

test('balances sum to zero, to the cent', () => {
  const people = ['p1', 'p2', 'p3'].map((id) => ({ id }))
  const expenses = [
    { amount: 1000, paidBy: 'p1', among: ['p1', 'p2', 'p3'] },
    { amount: 3333, paidBy: 'p2', among: ['p1', 'p3'] },
    { amount: 1, paidBy: 'p3', among: ['p1', 'p2', 'p3'] },
  ]
  const balance = balances(people, expenses)
  assert.deepEqual(Object.fromEntries(balance), { p1: 1000 - 334 - 1667 - 1, p2: 3333 - 333, p3: 1 - 333 - 1666 })
  assert.equal(total(balance.values()), 0)
})

test('a group with no people, or nobody owing, needs no transfers', () => {
  assert.deepEqual(settle(balances([], [])), [])
  assert.deepEqual(settle(new Map([['p1', 0], ['p2', 0]])), [])
})

test('the transfers settle everyone, each from someone who owes to someone who is owed', () => {
  const balance = new Map([['ann', 2500], ['ben', -1000], ['cleo', -1500]])
  const transfers = settle(balance)
  assert.deepEqual(transfers.sort((a, b) => a.from.localeCompare(b.from)), [
    { from: 'ben', to: 'ann', amount: 1000 },
    { from: 'cleo', to: 'ann', amount: 1500 },
  ])
  assert.ok([...afterPaying(balance, transfers).values()].every((cents) => cents === 0))
})

// The case the usual shortcut gets wrong: paying the largest debt to the
// largest creditor sends 10.00 to the one owed 12.00, and then needs four
// transfers. Two groups settle among themselves in three.
test('a group that can settle among itself is not mixed with the rest', () => {
  const balance = new Map([['a', -1000], ['b', -400], ['d', -800], ['e', 1200], ['c', 1000]])
  const transfers = settle(balance)
  assert.equal(transfers.length, 3)
  assert.deepEqual(transfers.find((t) => t.from === 'a'), { from: 'a', to: 'c', amount: 1000 })
  assert.ok([...afterPaying(balance, transfers).values()].every((cents) => cents === 0))
})

test('the number of transfers is the fewest possible, on many bills', () => {
  let seed = 7
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
  for (let round = 0; round < 300; round += 1) {
    const n = 2 + Math.floor(random() * 6)
    const values = Array.from({ length: n - 1 }, () => Math.floor(random() * 11) - 5)
    values.push(-total(values))
    const balance = new Map(values.map((cents, i) => [`p${i}`, cents]))
    const transfers = settle(balance)
    assert.ok([...afterPaying(balance, transfers).values()].every((cents) => cents === 0), values.join(','))
    assert.equal(transfers.length, fewestByBruteForce(values), values.join(','))
  }
})

test('balances that do not sum to zero, or too many of them, are refused', () => {
  assert.throws(() => settle(new Map([['a', 100], ['b', -99]])), RangeError)
  const many = new Map(Array.from({ length: MAX_SETTLE + 1 }, (_, i) => [`p${i}`, i === 0 ? MAX_SETTLE : -1]))
  assert.throws(() => settle(many), RangeError)
})
