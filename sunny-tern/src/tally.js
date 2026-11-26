// The tally, without React: what a count is, how it changes and how it is
// kept. The page and the tests both use these, so what the tests prove is what
// the page does.

/** The birds the tally offers, in the order it shows them. */
export const BIRDS = [
  { id: 'common-tern', name: 'common tern' },
  { id: 'black-headed-gull', name: 'black-headed gull' },
  { id: 'mallard', name: 'mallard' },
  { id: 'grey-heron', name: 'grey heron' },
  { id: 'kingfisher', name: 'kingfisher' },
]

/** No bird is counted past this, so a stuck key cannot grow the number without end. */
export const MAX_COUNT = 999

/** Where the tally is kept in the browser. Nothing is sent anywhere. */
export const STORAGE_KEY = 'sunny-tern:tally'

export const emptyTally = () => Object.fromEntries(BIRDS.map((bird) => [bird.id, 0]))

const clamp = (n) => Math.min(MAX_COUNT, Math.max(0, n))

/** One more, or one fewer, of one bird. A bird the tally does not offer is left out. */
export function step(tally, id, by) {
  if (!Object.hasOwn(tally, id)) return tally
  return { ...tally, [id]: clamp(tally[id] + by) }
}

export const total = (tally) => Object.values(tally).reduce((sum, n) => sum + n, 0)

/**
 * The tally a browser kept, or an empty one. Whatever is stored was written by
 * an older version of this page or by hand, so every value is checked: a bird
 * that is no longer offered is dropped, and a count that is not a whole number
 * in range starts from 0.
 */
export function load(storage) {
  const tally = emptyTally()
  if (!storage) return tally
  let stored
  try {
    stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return tally
  }
  if (stored === null || typeof stored !== 'object') return tally
  for (const id of Object.keys(tally)) {
    const n = stored[id]
    if (Number.isInteger(n) && n >= 0 && n <= MAX_COUNT) tally[id] = n
  }
  return tally
}

/**
 * Keep the tally. A browser may refuse (a private window, a full quota); the
 * count still works for as long as the page is open, and the answer says
 * whether it was kept.
 */
export function save(storage, tally) {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(tally))
    return true
  } catch {
    return false
  }
}
