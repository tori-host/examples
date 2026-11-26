// The bill, without React: who is in the group, what was spent, how a change
// is made and how the bill is kept in the browser. The page and the tests both
// use these, so what the tests prove is what the page does. The arithmetic is
// in settle.js.
import { MAX_CENTS, parseAmount } from './settle.js'

/** Where the bill is kept in the browser. Nothing is sent anywhere. */
export const STORAGE_KEY = 'sunny-tern:bill'

// Bounds, so a stuck key or an edited storage cannot grow the page without end.
export const MAX_PEOPLE = 12
export const MAX_EXPENSES = 100
export const MAX_NAME = 30
export const MAX_TITLE = 40

export const emptyBill = () => ({ people: [], expenses: [] })

/**
 * The next free id with a prefix: `p1`, `p2`... Taken from the bill a change
 * is made to, which is what the browser holds now, so two tabs adding a
 * person one after the other do not hand out the same id.
 */
function nextId(prefix, items) {
  const taken = items.map((item) => Number(item.id.slice(1)))
  return `${prefix}${Math.max(0, ...taken) + 1}`
}

const cleanText = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > 0 && clean.length <= max ? clean : null
}

// Each change returns `{ bill }` or `{ error }`, never both. An error is one
// of these sentences, so what the page shows is never what was typed.
export const ERRORS = {
  name: `A name is 1 to ${MAX_NAME} characters.`,
  duplicate: 'Someone in the group already has that name.',
  people: `A group has at most ${MAX_PEOPLE} people.`,
  inUse: 'Someone who paid or shares an expense stays in the group until that expense is removed.',
  title: `What it was for is 1 to ${MAX_TITLE} characters.`,
  amount: 'An amount is a number above zero, with at most two decimals, up to 1000000.',
  paidBy: 'Choose who paid.',
  among: 'Choose at least one person to split it among.',
  expenses: `A bill has at most ${MAX_EXPENSES} expenses.`,
}

export function addPerson(bill, name) {
  const clean = cleanText(name, MAX_NAME)
  if (!clean) return { error: ERRORS.name }
  if (bill.people.length >= MAX_PEOPLE) return { error: ERRORS.people }
  if (bill.people.some((person) => person.name.toLowerCase() === clean.toLowerCase())) return { error: ERRORS.duplicate }
  return { bill: { ...bill, people: [...bill.people, { id: nextId('p', bill.people), name: clean }] } }
}

export function removePerson(bill, id) {
  if (bill.expenses.some((expense) => expense.paidBy === id || expense.among.includes(id))) return { error: ERRORS.inUse }
  return { bill: { ...bill, people: bill.people.filter((person) => person.id !== id) } }
}

/** An expense split equally among `among`, in the order the group lists them. */
export function addExpense(bill, { title, amount, paidBy, among }) {
  const cleanTitle = cleanText(title, MAX_TITLE)
  if (!cleanTitle) return { error: ERRORS.title }
  const cents = parseAmount(amount)
  if (cents === null) return { error: ERRORS.amount }
  const ids = new Set(bill.people.map((person) => person.id))
  if (!ids.has(paidBy)) return { error: ERRORS.paidBy }
  const chosen = new Set(among)
  const sharedBy = bill.people.map((person) => person.id).filter((id) => chosen.has(id))
  if (sharedBy.length === 0) return { error: ERRORS.among }
  if (bill.expenses.length >= MAX_EXPENSES) return { error: ERRORS.expenses }
  const expense = { id: nextId('e', bill.expenses), title: cleanTitle, amount: cents, paidBy, among: sharedBy }
  return { bill: { ...bill, expenses: [...bill.expenses, expense] } }
}

export function removeExpense(bill, id) {
  return { bill: { ...bill, expenses: bill.expenses.filter((expense) => expense.id !== id) } }
}

/**
 * The bill a browser kept, or an empty one. Whatever is stored was written by
 * an older version of this page or by hand, so nothing is trusted: a person
 * or an expense that is not exactly what this page writes is dropped, and so
 * is an expense that names someone who is not in the group.
 */
export function load(storage) {
  if (!storage) return emptyBill()
  let stored
  try {
    stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return emptyBill()
  }
  if (stored === null || typeof stored !== 'object') return emptyBill()

  const people = []
  for (const person of Array.isArray(stored.people) ? stored.people : []) {
    if (people.length >= MAX_PEOPLE) break
    if (person === null || typeof person !== 'object' || !/^p[1-9]\d{0,5}$/.test(person.id)) continue
    const name = typeof person.name === 'string' ? cleanText(person.name, MAX_NAME) : null
    if (!name || name !== person.name || people.some((p) => p.id === person.id)) continue
    people.push({ id: person.id, name })
  }
  const ids = new Set(people.map((person) => person.id))

  const expenses = []
  for (const expense of Array.isArray(stored.expenses) ? stored.expenses : []) {
    if (expenses.length >= MAX_EXPENSES) break
    if (expense === null || typeof expense !== 'object' || !/^e[1-9]\d{0,5}$/.test(expense.id)) continue
    if (expenses.some((e) => e.id === expense.id)) continue
    const title = typeof expense.title === 'string' ? cleanText(expense.title, MAX_TITLE) : null
    if (!title || title !== expense.title) continue
    if (!Number.isInteger(expense.amount) || expense.amount < 1 || expense.amount > MAX_CENTS) continue
    if (!ids.has(expense.paidBy) || !Array.isArray(expense.among) || expense.among.length === 0) continue
    if (new Set(expense.among).size !== expense.among.length || !expense.among.every((id) => ids.has(id))) continue
    expenses.push({ id: expense.id, title, amount: expense.amount, paidBy: expense.paidBy, among: [...expense.among] })
  }
  return { people, expenses }
}

/**
 * Keep the bill. A browser may refuse (a private window, a full quota); the
 * page still works for as long as it is open, and the answer says whether
 * the bill was kept.
 */
export function save(storage, bill) {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bill))
    return true
  } catch {
    return false
  }
}
