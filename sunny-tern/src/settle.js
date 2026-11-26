// Who owes whom, without React and without storage: pure functions over whole
// cents. Money is never a float here. 0.1 + 0.2 is not 0.3 in floating point,
// and a bill that is off by a cent is a bill nobody trusts; integers add up
// exactly, so every balance below sums to zero, not to nearly zero.

/** The largest amount one expense may have, in cents: 1 000 000.00. */
export const MAX_CENTS = 100_000_000

/**
 * Cents from what a person typed: `12`, `12.5`, `12.50` or `12,50`. Anything
 * else, a negative amount, zero, more than two decimals or more than
 * MAX_CENTS, is `null`: refused, never guessed.
 */
export function parseAmount(text) {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(String(text).trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return cents > 0 && cents <= MAX_CENTS ? cents : null
}

/** `1250` → `12.50`. */
export const formatAmount = (cents) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`

/**
 * An amount split equally into `n` shares of whole cents. 10.00 among three
 * is 3.34, 3.33 and 3.33: the cents that do not divide go one each to the
 * first shares, so the shares always add up to the amount.
 */
export function shares(cents, n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('an expense has to be split among at least one person')
  const base = Math.floor(cents / n)
  const rest = cents - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0))
}

/**
 * Each person's balance in cents: what they paid minus their share of what
 * was spent. Positive is owed money, negative owes it. The order of `among`
 * decides who gets the odd cents, so the same bill always gives the same
 * balances.
 */
export function balances(people, expenses) {
  const balance = new Map(people.map((person) => [person.id, 0]))
  for (const expense of expenses) {
    if (!balance.has(expense.paidBy) || expense.among.some((id) => !balance.has(id))) {
      throw new RangeError('an expense names someone who is not in the group')
    }
    balance.set(expense.paidBy, balance.get(expense.paidBy) + expense.amount)
    shares(expense.amount, expense.among.length).forEach((share, i) => {
      balance.set(expense.among[i], balance.get(expense.among[i]) - share)
    })
  }
  return balance
}

/** Above this many people with a balance, finding the fewest transfers would take too long. */
export const MAX_SETTLE = 16

/**
 * The fewest transfers that settle every balance, as `{ from, to, amount }`.
 *
 * Paying the largest debt to the largest creditor, round after round, is the
 * usual shortcut, and it can take one transfer more than needed: it may split
 * a debt that a smaller group could have settled among itself. The fewest
 * transfers are the number of people with a balance minus the largest number
 * of groups whose balances sum to zero, since a group of k settles in k - 1.
 * That is found by trying every subset, which is 2^n work: fine for a group
 * at a dinner table, hence MAX_SETTLE.
 */
export function settle(balance) {
  const open = [...balance].filter(([, cents]) => cents !== 0)
  const n = open.length
  if (n === 0) return []
  if (n > MAX_SETTLE) throw new RangeError(`at most ${MAX_SETTLE} people with a balance can be settled`)
  if (open.reduce((sum, [, cents]) => sum + cents, 0) !== 0) throw new RangeError('the balances do not sum to zero')

  // A subset of the people is a bit mask: bit i is open[i]. For each subset,
  // sum[mask] is its total balance, groups[mask] the most zero-sum groups it
  // splits into, and last[mask] the person to take off it to get there.
  const full = (1 << n) - 1
  const sum = new Array(full + 1).fill(0)
  const groups = new Array(full + 1).fill(0)
  const last = new Array(full + 1).fill(-1)
  for (let mask = 1; mask <= full; mask += 1) {
    let best = -1
    for (let i = 0; i < n; i += 1) {
      const bit = 1 << i
      if (!(mask & bit)) continue
      if (best === -1) sum[mask] = sum[mask ^ bit] + open[i][1]
      if (groups[mask ^ bit] > best) {
        best = groups[mask ^ bit]
        last[mask] = i
      }
    }
    groups[mask] = best + (sum[mask] === 0 ? 1 : 0)
  }

  // Walk back from everyone, one person at a time. Each time the people left
  // sum to zero, the ones taken off since the last time are one group.
  const transfers = []
  let group = []
  for (let mask = full; mask !== 0; ) {
    const i = last[mask]
    group.push(open[i])
    mask &= ~(1 << i)
    if (sum[mask] === 0) {
      transfers.push(...settleGroup(group))
      group = []
    }
  }
  return transfers
}

/** A group whose balances sum to zero, settled in one transfer fewer than its size. */
function settleGroup(group) {
  const debtors = group.filter(([, c]) => c < 0).map(([id, c]) => ({ id, left: -c }))
  const creditors = group.filter(([, c]) => c > 0).map(([id, c]) => ({ id, left: c }))
  const transfers = []
  let d = 0
  let c = 0
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].left, creditors[c].left)
    transfers.push({ from: debtors[d].id, to: creditors[c].id, amount })
    debtors[d].left -= amount
    creditors[c].left -= amount
    if (debtors[d].left === 0) d += 1
    if (creditors[c].left === 0) c += 1
  }
  return transfers
}
