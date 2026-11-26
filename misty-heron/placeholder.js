// The placeholder images, apart from the server so they can be tested without
// starting one.
//
// An image says its own size and nothing else. Its text is built from two
// integers and its colours from two hex strings, each checked against a
// pattern that admits nothing more, so no address anyone writes can put words,
// markup or a link into an SVG served from this domain.

export const MIN_SIDE = 1
export const MAX_SIDE = 4000
export const DEFAULT_BG = 'e8e5dd'
export const DEFAULT_FG = '46525d'

/** The paths that ask for an image: `/<width>x<height>.svg`. */
export const IMAGE_PATH = /^\/(\d+)x(\d+)\.svg$/

/**
 * A side from the path, or null. A whole number from MIN_SIDE to MAX_SIDE
 * written without leading zeros, so each image has one address and the
 * cache keeps one copy of it.
 */
export function parseSide(text) {
  if (!/^[1-9]\d*$/.test(text)) return null
  const n = Number(text)
  return n >= MIN_SIDE && n <= MAX_SIDE ? n : null
}

/**
 * A colour from the query, lowercased, or null. Exactly three or six hex
 * digits, without `#`. A value Express parsed into an array or an object
 * (`?bg=1&bg=2`) is not a string, and is refused too.
 */
export function parseColor(value) {
  if (typeof value !== 'string' || !/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return null
  return value.toLowerCase()
}

/**
 * The SVG. `width` and `height` are numbers that parseSide accepted and the
 * colours strings that parseColor accepted; nothing else is interpolated.
 */
export function placeholderSvg({ width, height, bg = DEFAULT_BG, fg = DEFAULT_FG }) {
  // The label is about 6 em wide at its longest (`4000 × 4000`): sized so it
  // fits the width and half the height.
  const fontSize = Math.max(1, Math.floor(Math.min(width / 6.5, height / 2)))
  const label = `${width} × ${height}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
<rect width="${width}" height="${height}" fill="#${bg}"/>
<text x="50%" y="50%" fill="#${fg}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text>
</svg>
`
}

/**
 * What a request for `path` with `query` gets: `{ svg }`, `{ error }`, or
 * null when the path does not ask for an image at all. The error is one of
 * a fixed set of sentences, never the value that was refused.
 */
export function placeholderFor(path, query) {
  const match = IMAGE_PATH.exec(path)
  if (!match) return null
  const width = parseSide(match[1])
  const height = parseSide(match[2])
  if (width === null || height === null) return { error: `Width and height are whole numbers from ${MIN_SIDE} to ${MAX_SIDE}.` }
  // Only these two: a parameter that is ignored would give one image many
  // addresses, and suggest that something else could be asked for.
  if (Object.keys(query).some((key) => key !== 'bg' && key !== 'fg')) return { error: 'The only parameters are bg and fg.' }
  const bg = query.bg === undefined ? DEFAULT_BG : parseColor(query.bg)
  const fg = query.fg === undefined ? DEFAULT_FG : parseColor(query.fg)
  if (bg === null || fg === null) return { error: 'bg and fg are colours of exactly 3 or 6 hex digits, without #.' }
  return { svg: placeholderSvg({ width, height, bg, fg }) }
}
