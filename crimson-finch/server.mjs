// crimson finch: the bird log on the tori.host homepage, as a real server.
//
// The homepage draws this app next to its terminal and says "the app you just
// deployed". Until this file existed that address answered 404. It is
// deliberately the kind of app a coding agent writes in an evening: one file,
// no dependencies, state in memory.
//
// Three decisions that are not obvious from the code:
//
// - Nothing a visitor types is ever shown to another visitor. A bird is
//   "logged" from a fixed list, a heart is a counter. A demo linked from a
//   homepage with a free-text field is a billboard for whoever finds it first.
// - The state is in memory on purpose. A server app on Tori naps when nobody
//   visits and wakes on the next request; the counts starting over is that
//   behaviour made visible, and the page says so.
// - Writes are capped per minute for the whole process, not per visitor: the
//   app sits behind a load balancer and has no trustworthy visitor address to
//   count by, and a cap that can be dodged by a header is not a cap.
//
// What that costs, knowingly: "the whole process" is one
// copy of the app. Tori starts a second copy of a service once one copy has
// about seventy requests in flight at the same moment, up to the plan's
// ceiling, and each copy would hold its own list and its own cap. A request
// here takes a millisecond or two, so that is tens of thousands of requests a
// second: a flood, not a busy day. During one, visitors would see different
// lists from one request to the next, and the page would show the start time
// of whichever copy answered. An app whose state has to agree with itself
// under load keeps it outside the process; this one shows what happens when
// it does not, and the README says so.
import { createServer } from 'node:http'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const asset = (name) => readFileSync(new URL(`./public/${name}`, import.meta.url))

/** Every bird there is to spot. The first three are the homepage's. */
export const CATALOGUE = [
  { id: 'vermilion-flycatcher', name: 'vermilion flycatcher', tone: 'vermilion', hearts: 12 },
  { id: 'cloud-swift', name: 'cloud swift', tone: 'sky', hearts: 8 },
  { id: 'sunrise-sparrow', name: 'sunrise sparrow', tone: 'coral', hearts: 5 },
  { id: 'paper-wren', name: 'paper wren', tone: 'ink', hearts: 0 },
  { id: 'amber-warbler', name: 'amber warbler', tone: 'coral', hearts: 0 },
  { id: 'misty-heron', name: 'misty heron', tone: 'sky', hearts: 0 },
  { id: 'night-owl', name: 'night owl', tone: 'ink', hearts: 0 },
  { id: 'crimson-finch', name: 'crimson finch', tone: 'vermilion', hearts: 0 },
  { id: 'silver-gull', name: 'silver gull', tone: 'sky', hearts: 0 },
  { id: 'sunny-lark', name: 'sunny lark', tone: 'coral', hearts: 0 },
]

/** How many birds are on the list when the server starts. */
export const SPOTTED_AT_START = 3
export const MAX_HEARTS = 9999
export const DEFAULT_WRITES_PER_MINUTE = 120
/** Where this app runs. Tori has one location today; the app is told nothing, so it says what its owner knows. */
export const LOCATION = 'Prague, EU'

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  // Not `no-referrer`: under that policy a browser sends `Origin: null` on
  // the page's own POSTs, which is what the cross-site check refuses. A
  // browser that also sends `Sec-Fetch-Site` gets through regardless, so the
  // page worked wherever it was tried, and an older one could not click
  // either button. `same-origin` sends this app its own
  // origin and still tells no other site where a visitor came from.
  'Referrer-Policy': 'same-origin',
  // The meta tag covers the page; this covers the API and the files too.
  'X-Robots-Tag': 'noindex',
}

const hearts = (n) => `${n} ${n === 1 ? 'heart' : 'hearts'}`

/**
 * What a heart button is called, for someone who cannot see it: the action
 * and the count. The visible text is only the glyph and a number, and an
 * `aria-label` replaces a button's text as its name, so without the count
 * here a screen reader says which bird and never how many.
 * Written once, here; the page's script takes it from the list it is sent.
 */
export const heartLabel = (bird) => `Give ${bird.name} a heart. It has ${hearts(bird.hearts)}.`

/**
 * Whether a write was sent by a page on another site. A browser needs no
 * permission to *send* a cross-site POST, only to read the answer, so
 * without this any page on the web could make its visitors give hearts and
 * log birds here, and use up the write cap doing it.
 *
 * `Sec-Fetch-Site` is the browser's own statement and cannot be set by a
 * page; where it is absent, `Origin` is compared with the host that was
 * asked. A request with neither is not a browser acting for another site
 * (curl, a script), and is let through: the cap is what bounds those.
 */
export function fromAnotherSite(headers) {
  const site = headers['sec-fetch-site']
  if (site !== undefined) return site !== 'same-origin' && site !== 'none'
  const origin = headers.origin
  if (origin === undefined) return false
  try {
    return new URL(origin).host !== headers.host
  } catch {
    // `Origin: null` (a sandboxed frame, a file) and anything unparseable.
    return true
  }
}

/** A start time as the footer shows it; the page's script is sent the same words. */
export const startedText = (iso) => `${iso.replace('T', ' ').replace(/\..*$/, '')} UTC`

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function page(state) {
  const rows = state.spotted
    .map(
      (bird) => `
        <li class="row tone-${bird.tone}" data-bird="${escapeHtml(bird.id)}">
          <span class="mark" aria-hidden="true">[oo}</span>
          <span class="name">${escapeHtml(bird.name)}</span>
          <button class="heart" type="button" aria-label="${escapeHtml(heartLabel(bird))}">
            <span aria-hidden="true">&hearts;</span> <span class="count">${bird.hearts}</span>
          </button>
        </li>`,
    )
    .join('')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>crimson finch — birds spotted today</title>
    <meta name="description" content="The demo app from the tori.host homepage, running on Tori in ${LOCATION}." />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <main>
      <header>
        <img src="/favicon.svg" alt="" width="36" height="36" />
        <h1>crimson finch</h1>
        <span class="live"><span class="dot" aria-hidden="true"></span> live</span>
      </header>
      <p class="lead">birds spotted today</p>
      <ul id="birds">${rows}
      </ul>
      <button id="log" type="button">+ log a bird</button>
      <p id="notice" role="status" aria-live="polite" tabindex="-1"></p>
      <noscript><p class="note">The list is here without JavaScript; the buttons need it.</p></noscript>
      <footer>
        <p>
          This is the app on the <a href="https://tori.host/">tori.host</a> homepage, deployed with
          <code>npx tori.host</code>. It is an example run by Tori, in ${LOCATION}, in a sandbox of its own. The
          source is on <a href="https://github.com/tori-host/examples/tree/main/crimson-finch">GitHub</a>.
        </p>
        <p>
          The counts live in this server's memory. An app on Tori naps when nobody visits and wakes on the next
          request, so after a nap or a new deploy they start over. This server started
          <time id="started" datetime="${state.startedAt}">${startedText(state.startedAt)}</time>.
        </p>
      </footer>
    </main>
    <script src="/app.js" defer></script>
  </body>
</html>
`
}

/**
 * The app. `writesPerMinute`, `maxHearts` and `now` are parameters so a test
 * can reach the cap and the ceiling in a few requests and move the clock
 * without waiting a minute.
 */
export function createApp({
  writesPerMinute = DEFAULT_WRITES_PER_MINUTE,
  maxHearts = MAX_HEARTS,
  now = () => Date.now(),
} = {}) {
  const state = {
    startedAt: new Date(now()).toISOString(),
    spotted: CATALOGUE.slice(0, SPOTTED_AT_START).map((bird) => ({ ...bird })),
  }
  // A fixed window: at most `writesPerMinute` writes in each clock minute.
  let windowStart = now()
  let writesInWindow = 0
  const mayWrite = () => {
    if (now() - windowStart >= 60_000) {
      windowStart = now()
      writesInWindow = 0
    }
    if (writesInWindow >= writesPerMinute) return false
    writesInWindow += 1
    return true
  }

  const files = {
    '/app.css': ['text/css; charset=utf-8', asset('app.css')],
    '/app.js': ['text/javascript; charset=utf-8', asset('app.js')],
    '/favicon.svg': ['image/svg+xml', asset('favicon.svg')],
  }

  const send = (res, status, type, body, extra = {}) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': bytes.length, ...extra })
    res.end(res.req.method === 'HEAD' ? undefined : bytes)
  }
  const json = (res, status, value, extra = {}) =>
    send(res, status, 'application/json; charset=utf-8', JSON.stringify(value), { 'Cache-Control': 'no-store', ...extra })
  const birdsView = () => ({
    birds: state.spotted.map((bird) => ({
      id: bird.id,
      name: bird.name,
      tone: bird.tone,
      hearts: bird.hearts,
      heartLabel: heartLabel(bird),
    })),
    left: CATALOGUE.length - state.spotted.length,
    startedAt: state.startedAt,
    startedText: startedText(state.startedAt),
    location: LOCATION,
  })

  const handle = (req, res) => {
    // No route reads a body. One that arrives is not buffered: it is drained
    // and dropped, so a large upload costs this process nothing but the read.
    req.resume()
    // The path is what stands before the first `?`, taken as text. Not
    // `new URL(req.url, base)`: Node's HTTP parser accepts request targets
    // that the URL parser throws on (`//[` is one), and a throw in a request
    // listener is an uncaught exception, so one such request stopped the
    // whole server. Every route here is plain ASCII, so
    // nothing needs decoding, and a target that is not a route is a 404.
    const path = (req.url ?? '/').split('?', 1)[0]
    const read = req.method === 'GET' || req.method === 'HEAD'

    if (path === '/healthz' && read) return send(res, 200, 'text/plain; charset=utf-8', 'ok\n', { 'Cache-Control': 'no-store' })
    if (path === '/' && read) return send(res, 200, 'text/html; charset=utf-8', page(state), { 'Cache-Control': 'no-store' })
    if (files[path] && read) return send(res, 200, files[path][0], files[path][1], { 'Cache-Control': 'public, max-age=300' })
    if (path === '/api/birds' && read) return json(res, 200, birdsView())

    const heart = /^\/api\/birds\/([a-z-]{1,40})\/heart$/.exec(path)
    const write = path === '/api/birds' || heart !== null
    if (write && req.method !== 'POST') {
      // The list can also be read at its address; a heart can only be given.
      return json(res, 405, { error: 'method not allowed' }, { Allow: heart ? 'POST' : 'GET, HEAD, POST' })
    }
    if (write) {
      // Before the cap, so that another site's page cannot spend it either.
      if (fromAnotherSite(req.headers)) {
        return json(res, 403, { error: 'This demo takes clicks from its own page only.' })
      }
      if (!mayWrite()) {
        return json(res, 429, { error: 'This demo takes a limited number of clicks a minute. Try again shortly.' }, { 'Retry-After': '60' })
      }
      if (heart) {
        const bird = state.spotted.find((b) => b.id === heart[1])
        // The list a page shows can be older than this server: after a nap
        // the birds a visitor logged are gone. The answer carries the list as
        // it is now, so the page can show that instead of a dead button.
        if (!bird) return json(res, 404, { error: 'That bird is not on the list any more.', ...birdsView() })
        bird.hearts = Math.min(maxHearts, bird.hearts + 1)
        // `said` is what the page announces: a click that only changed a
        // number on screen would otherwise tell a screen reader nothing.
        return json(res, 200, { id: bird.id, hearts: bird.hearts, said: `${bird.name} has ${hearts(bird.hearts)}.`, ...birdsView() })
      }
      const next = CATALOGUE.find((candidate) => !state.spotted.some((b) => b.id === candidate.id))
      // The button is never disabled for this. A page cannot know that a full
      // list is still full: the server naps and starts over with three. So
      // the click is always possible, and when the list is full this says so.
      if (!next) return json(res, 409, { error: 'Every bird is on the list.', ...birdsView() })
      state.spotted.push({ ...next })
      return json(res, 201, {
        bird: { id: next.id, name: next.name, tone: next.tone, hearts: next.hearts },
        said: `${next.name} is on the list.`,
        ...birdsView(),
      })
    }

    if (!read && (path === '/' || path === '/healthz' || files[path])) {
      return json(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' })
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Nothing here. The bird log is at /\n')
  }

  // Whatever a request does, the next one is still answered. The handler
  // above is not expected to throw; this is so that a mistake in it costs one
  // response and not the process, with its counts and every visitor on it.
  return createServer((req, res) => {
    try {
      handle(req, res)
    } catch (error) {
      console.error('request failed:', error)
      if (res.headersSent) res.destroy()
      else send(res, 500, 'text/plain; charset=utf-8', 'Something went wrong here.\n')
    }
  })
}

// Started as a program (not imported by the test): listen where Tori expects
// a service, and leave when asked — a napping app is stopped with SIGTERM.
//
// "Am I the program?" compares real paths on both sides. Node resolves
// symlinks in the module's own URL and leaves `process.argv[1]` as it was
// typed, so comparing the two as text is false whenever a symlink is on the
// path, and the file then does nothing, prints nothing and exits 0: a server
// that "started" and is not there. The first version did exactly that; the
// repository's check for it (scripts/ci/entry-guards.test.mjs) starts this
// file through a symlink.
const startedAsProgram = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (startedAsProgram) {
  // It takes none. Refusing one is better than a typo that seems to work:
  // `node server.mjs --port 3000` would otherwise listen on 8080 and say so
  // only to someone reading the log.
  const extra = process.argv.slice(2)
  if (extra.length > 0) {
    console.error(`crimson finch takes no arguments, got: ${extra.join(' ')}. The port comes from PORT.`)
    process.exit(2)
  }
  const port = Number(process.env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`PORT must be a port number, got: ${process.env.PORT}`)
    process.exit(2)
  }
  const server = createApp()
  server.listen(port, '0.0.0.0', () => console.log(`crimson finch is listening on ${port}`))
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`${signal}: closing`)
      server.close(() => process.exit(0))
      server.closeIdleConnections?.()
    })
  }
}
