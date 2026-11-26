// The two ways the pages list posts: newest first, and grouped by tag.

export function newestFirst(posts) {
  return [...posts].sort((a, b) => b.data.date - a.data.date || a.id.localeCompare(b.id))
}

/** Every tag, alphabetically, with its posts newest first. */
export function byTag(posts) {
  const tags = new Map()
  for (const post of newestFirst(posts)) {
    for (const tag of post.data.tags) {
      if (!tags.has(tag)) tags.set(tag, [])
      tags.get(tag).push(post)
    }
  }
  return new Map([...tags].sort(([a], [b]) => a.localeCompare(b)))
}

// The dates are calendar days, written without a time, so they are read
// and shown in UTC: in a local zone west of it, 14 March would print as 13.
export function longDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10)
}
