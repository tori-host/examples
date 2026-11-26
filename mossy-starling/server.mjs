// mossy starling: a server that keeps its data in Tori's managed Postgres.
//
// crimson finch, the homepage's demo, keeps its counts in memory, and they
// start over whenever it naps. This one keeps them in a database, so they are
// still there after a nap, a restart or a new deploy. That is the whole point
// of the example, and the page says so.
//
// Two decisions that are not obvious from the code:
//
// - The buttons are plain HTML forms. A click posts, the server counts it and
//   sends the browser back to the page. No script is needed, and none is sent.
// - Nothing a visitor types is stored or shown: a sighting is a click on a
//   bird from a fixed list. A public example with a text field would be a
//   billboard for whoever finds it first.
import { createServer } from 'node:http'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './db.mjs'

export const LOCATION = 'Prague, EU'
const SOURCE = 'https://github.com/tori-host/examples/tree/main/mossy-starling'
export const DEFAULT_WRITES_PER_MINUTE = 120

export const BIRDS = [
  { id: 'common-starling', name: 'common starling' },
  { id: 'house-sparrow', name: 'house sparrow' },
  { id: 'common-blackbird', name: 'common blackbird' },
  { id: 'great-tit', name: 'great tit' },
  { id: 'eurasian-magpie', name: 'Eurasian magpie' },
]

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  // Not `no-referrer`: under it some browsers send `Origin: null` on the
  // page's own form posts, which the check below refuses.
  'Referrer-Policy': 'same-origin',
  // The pages on tori.host are the ones meant to be found; this copy is not.
  'X-Robots-Tag': 'noindex',
}

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Whether a post was sent by a page on another site. A browser needs no
 * permission to send a cross-site form, so without this any page on the web
 * could make its visitors count birds here. `Sec-Fetch-Site` is the browser's
 * own statement; where it is absent, `Origin` is compared with the host that
 * was asked. A request with neither is not a browser acting for another site
 * (curl, a script), and the cap is what bounds those.
 */
export function fromAnotherSite(headers) {
  const site = headers['sec-fetch-site']
  if (site !== undefined) return site !== 'same-origin' && site !== 'none'
  const origin = headers.origin
  if (origin === undefined) return false
  try {
    return new URL(origin).host !== headers.host
  } catch {
    return true
  }
}

const DEPLOY_STEPS = `npx tori.host db create
npx tori.host db status        # again, until it says ready
npx tori.host env list         # again, until DATABASE_URL is listed
npx tori.host deploy --release "node migrate.mjs"`

/** What the page says instead of the list when the database is not there yet. */
const NOT_READY = {
  missing: {
    title: 'No database yet',
    text: 'This copy of the server was deployed without a database, so it has nowhere to keep a count. Create one, wait until it is ready and its address is attached to the app, then deploy again with the release command that creates the table:',
  },
  unmigrated: {
    title: 'The database is empty',
    text: 'The database is there, and the table this server counts in is not. It is created by the release command, which runs before a deploy takes traffic:',
  },
  unreachable: {
    title: 'The database did not answer',
    text: 'This server could not reach its database just now, so it cannot show the counts. The server log says why: npx tori.host logs. Reloading may be enough.',
  },
}

function page(view, startedAt) {
  const notice = view.notice ? `<p class="notice" role="status">${escapeHtml(view.notice)}</p>` : ''
  const body =
    view.state === 'ready'
      ? `<ul class="sightings">${BIRDS.map((bird) => {
          const seen = view.counts.get(bird.id)
          const count = seen?.count ?? 0
          return `
          <li class="card row" data-bird="${escapeHtml(bird.id)}">
            <span class="name">${escapeHtml(bird.name)}</span>
            <span class="count" aria-label="${escapeHtml(`${count} ${count === 1 ? 'sighting' : 'sightings'}`)}">${count}</span>
            <form method="post" action="/sightings/${escapeHtml(bird.id)}">
              <button type="submit" aria-label="${escapeHtml(`I saw a ${bird.name}`)}">I saw one</button>
            </form>
          </li>`
        }).join('')}
        </ul>
        ${notice}
        <p>Every count is a row in Postgres. They are still here after the server naps, restarts or is deployed again.</p>`
      : `${notice}
        <div class="card">
          <h2>${escapeHtml(NOT_READY[view.state].title)}</h2>
          <p>${escapeHtml(NOT_READY[view.state].text)}</p>
          ${view.state === 'unreachable' ? '' : `<pre><code>${escapeHtml(DEPLOY_STEPS)}</code></pre>`}
        </div>`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mossy starling — a server with Postgres on Tori</title>
    <meta name="description" content="An example server run by Tori that keeps its data in a managed Postgres database, in ${LOCATION}." />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body data-example="mossy-starling" data-database="${escapeHtml(view.state)}">
    <main>
      <header>
        <img src="/favicon.svg" alt="" width="36" height="36" />
        <h1>mossy starling</h1>
        <span class="tag">server + Postgres</span>
      </header>
      <p class="lead">Birds seen from a window, counted by everyone who visits.</p>
      ${body}

      <h2>How it runs</h2>
      <ul>
        <li>Tori builds the server from source and runs <code>npm start</code>. The database is Tori's managed Postgres;
          the server finds it in <code>DATABASE_URL</code>, which Tori sets.</li>
        <li>The table is created by <code>migrate.mjs</code>, which Tori runs as the release command before a new
          deploy takes traffic. If it fails, the deploy that was live keeps serving.</li>
        <li>This copy of the server started <time datetime="${startedAt}">${startedAt.replace('T', ' ').replace(/\..*$/, '')} UTC</time>.</li>
      </ul>

      <h2>Deploy your own</h2>
      <pre><code>git clone https://github.com/tori-host/examples
cd examples/mossy-starling
npx tori.host
${escapeHtml(DEPLOY_STEPS)}</code></pre>
      <p>The first deploy creates the service, which runs and says it has no database. The last one gives it the
        database and creates the table.</p>

      <footer>
        <p>This is an example run by <a href="https://tori.host/">Tori</a>, in ${LOCATION}. The source is on
          <a href="${SOURCE}">GitHub</a>.</p>
      </footer>
    </main>
  </body>
</html>
`
}

/**
 * The app. `db` is what `openDatabase()` returns (or null for none);
 * `writesPerMinute` and `now` are parameters so a test can reach the cap
 * without waiting a minute.
 */
export function createApp({ db, writesPerMinute = DEFAULT_WRITES_PER_MINUTE, now = () => Date.now() } = {}) {
  const startedAt = new Date(now()).toISOString()
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

  const asset = (name) => readFileSync(new URL(`./public/${name}`, import.meta.url))
  const files = {
    '/style.css': ['text/css; charset=utf-8', asset('style.css')],
    '/favicon.svg': ['image/svg+xml', asset('favicon.svg')],
  }

  const send = (res, status, type, body, extra = {}) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': bytes.length, ...extra })
    res.end(res.req.method === 'HEAD' ? undefined : bytes)
  }
  const text = (res, status, body, extra = {}) =>
    send(res, status, 'text/plain; charset=utf-8', `${body}\n`, { 'Cache-Control': 'no-store', ...extra })

  /** The state of the database and, when it is ready, the counts. Never throws. */
  const look = async () => {
    if (!db) return { state: 'missing' }
    try {
      const state = await db.state()
      return state === 'ready' ? { state, counts: await db.counts() } : { state }
    } catch (error) {
      console.error('database query failed:', error.message)
      return { state: 'unreachable' }
    }
  }

  // What the page says once, after a refused post: the browser comes back to
  // `/?refused=<reason>`, and the reason is one of these, never the visitor's text.
  const REFUSED = {
    busy: 'This example takes a limited number of sightings a minute. Try again shortly.',
    gone: 'That bird is not on the list.',
    // Not "was not counted": a write whose answer was lost may have been
    // committed, and a visitor told to retry would count it twice.
    failed: 'The database did not confirm that sighting, so it may or may not have been counted.',
  }
  // What follows that sentence depends on whether the page can show a count:
  // a database that has stopped answering since may be the reason for both.
  const AFTER_FAILED = {
    ready: 'The count above is what it holds now.',
    other: 'Look at the count again once the database answers, before you add it again.',
  }

  const handle = async (req, res) => {
    // A form post carries a small body this server does not need. It is
    // drained and dropped, never buffered.
    req.resume()
    const [path, query = ''] = (req.url ?? '/').split('?', 2)
    const read = req.method === 'GET' || req.method === 'HEAD'

    if (path === '/healthz' && read) return text(res, 200, 'ok')
    if (files[path] && read) return send(res, 200, files[path][0], files[path][1], { 'Cache-Control': 'public, max-age=300' })
    if (path === '/' && read) {
      const view = await look()
      const refused = new URLSearchParams(query).get('refused')
      if (refused && Object.hasOwn(REFUSED, refused)) view.notice = REFUSED[refused]
      if (refused === 'failed') view.notice += ` ${AFTER_FAILED[view.state === 'ready' ? 'ready' : 'other']}`
      return send(res, 200, 'text/html; charset=utf-8', page(view, startedAt), { 'Cache-Control': 'no-store' })
    }

    const sighting = /^\/sightings\/([a-z-]{1,40})$/.exec(path)
    if (sighting && req.method !== 'POST') return text(res, 405, 'method not allowed', { Allow: 'POST' })
    if (sighting) {
      // Before the cap, so that another site's page cannot spend it either.
      if (fromAnotherSite(req.headers)) return text(res, 403, 'This example takes sightings from its own page only.')
      const back = (refused) => send(res, 303, 'text/plain; charset=utf-8', '', { Location: refused ? `/?refused=${refused}` : '/' })
      if (!BIRDS.some((bird) => bird.id === sighting[1])) return back('gone')
      if (!mayWrite()) return back('busy')
      if (!db) return back()
      try {
        await db.record(sighting[1])
      } catch (error) {
        console.error('recording a sighting failed:', error.message)
        return back('failed')
      }
      return back()
    }

    if (!read && (path === '/' || path === '/healthz' || files[path])) return text(res, 405, 'method not allowed', { Allow: 'GET, HEAD' })
    return text(res, 404, 'Nothing here. The birds are at /')
  }

  return createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('request failed:', error)
      if (res.headersSent) res.destroy()
      else text(res, 500, 'Something went wrong here.')
    })
  })
}

const startedAsProgram = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (startedAsProgram) {
  const port = Number(process.env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`PORT must be a port number, got: ${process.env.PORT}`)
    process.exit(2)
  }
  const db = openDatabase()
  if (!db) console.log('DATABASE_URL is not set: running without a database, and the page says how to add one')
  const server = createApp({ db })
  server.listen(port, '0.0.0.0', () => console.log(`mossy starling is listening on ${port}`))
  // A napping service is stopped with SIGTERM: finish what is in flight, close the pool, leave.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`${signal}: closing`)
      server.close(async () => {
        await db?.close().catch(() => {})
        process.exit(0)
      })
      server.closeIdleConnections?.()
    })
  }
}
