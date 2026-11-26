// The birds of the day, and which one a date gets. Kept apart from the server
// so the choice can be tested without starting one.

export const BIRDS = [
  { id: 'grey-heron', name: 'grey heron', latin: 'Ardea cinerea' },
  { id: 'common-kingfisher', name: 'common kingfisher', latin: 'Alcedo atthis' },
  { id: 'mallard', name: 'mallard', latin: 'Anas platyrhynchos' },
  { id: 'common-tern', name: 'common tern', latin: 'Sterna hirundo' },
  { id: 'great-tit', name: 'great tit', latin: 'Parus major' },
  { id: 'european-robin', name: 'European robin', latin: 'Erithacus rubecula' },
  { id: 'common-blackbird', name: 'common blackbird', latin: 'Turdus merula' },
  { id: 'white-stork', name: 'white stork', latin: 'Ciconia ciconia' },
  { id: 'barn-swallow', name: 'barn swallow', latin: 'Hirundo rustica' },
  { id: 'common-swift', name: 'common swift', latin: 'Apus apus' },
  { id: 'eurasian-magpie', name: 'Eurasian magpie', latin: 'Pica pica' },
  { id: 'house-sparrow', name: 'house sparrow', latin: 'Passer domesticus' },
]

const DAY = 24 * 60 * 60 * 1000

/** The UTC calendar day of a time, as `YYYY-MM-DD`. */
export const dayOf = (time) => new Date(time).toISOString().slice(0, 10)

/**
 * The bird for the UTC day `time` falls on. The same day gives the same bird
 * on every copy of the server and after every restart, because it is computed
 * from the date and nothing else.
 */
export function birdOfTheDay(time) {
  const days = Math.floor(time / DAY)
  return { day: dayOf(time), bird: BIRDS[((days % BIRDS.length) + BIRDS.length) % BIRDS.length] }
}
