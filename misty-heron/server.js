// misty heron: a placeholder image service, an Express server that Tori
// builds from source. There is no Dockerfile: Tori sees `express` in
// package.json and the `start` script, and builds an image that runs
// `npm start` on port 8080.
import express from 'express'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MAX_SIDE, MIN_SIDE, placeholderFor } from './placeholder.js'

export const LOCATION = 'Prague, EU'
const SOURCE = 'https://github.com/tori-host/examples/tree/main/misty-heron'

/** The images the page shows, and the addresses it prints for them. All fixed here. */
const EXAMPLES = [
  { path: '/320x180.svg', note: 'the default colours' },
  { path: '/120x120.svg?bg=162028&fg=f1efe9', note: 'dark, with light text' },
  { path: '/480x80.svg?bg=f8c5c6&fg=bf2f1c', note: 'a banner, with three colours of the page' },
  { path: '/64x64.svg?bg=2a5dc2&fg=fff', note: 'three hex digits work too' },
]

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function page(startedAt) {
  const examples = EXAMPLES.map(
    ({ path, note }) => `
        <figure>
          <img src="${escapeHtml(path)}" alt="" />
          <figcaption><a href="${escapeHtml(path)}"><code>${escapeHtml(path)}</code></a>: ${escapeHtml(note)}</figcaption>
        </figure>`,
  ).join('')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>misty heron — placeholder images, an Express server on Tori</title>
    <meta name="description" content="Placeholder images of any size: an example Express server run by Tori, built from source without a Dockerfile, in ${LOCATION}." />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body data-example="misty-heron">
    <main>
      <header>
        <img src="/favicon.svg" alt="" width="36" height="36" />
        <h1>misty heron</h1>
        <span class="tag">Express server</span>
      </header>
      <p class="lead">Placeholder images for a layout that is waiting for its pictures. Ask for a size, get an SVG of
        that size that says how big it is.</p>

      <div class="card">
        <h2>Use it</h2>
        <pre><code>GET /&lt;width&gt;x&lt;height&gt;.svg
GET /&lt;width&gt;x&lt;height&gt;.svg?bg=&lt;hex&gt;&amp;fg=&lt;hex&gt;</code></pre>
        <ul>
          <li>Width and height are whole numbers from ${MIN_SIDE} to ${MAX_SIDE}.</li>
          <li><code>bg</code> is the background and <code>fg</code> the text, each exactly 3 or 6 hex digits, without
            <code>#</code>. Both are optional.</li>
          <li>The image says its size and nothing else; there is no parameter for text. Any other parameter, size or
            colour is a 400.</li>
          <li>An image never changes, so it is sent to be cached for a year.</li>
        </ul>
      </div>

      <h2>Examples</h2>
      <div class="examples">${examples}
      </div>

      <h2>How it runs</h2>
      <ul>
        <li>
          There is no Dockerfile. Tori finds <code>express</code> in <code>package.json</code>, builds an image from the
          source and runs <code>npm start</code>.
        </li>
        <li>
          Every image is drawn on request. When nobody visits for a while the server naps, and the next request wakes
          it, which takes a moment longer than the ones after it.
        </li>
        <li>This copy of the server started <time datetime="${startedAt}">${startedAt.replace('T', ' ').replace(/\..*$/, '')} UTC</time>.</li>
      </ul>

      <h2>Deploy your own</h2>
      <p>With Node.js installed:</p>
      <pre><code>git clone https://github.com/tori-host/examples
cd examples/misty-heron
npx tori.host</code></pre>
      <p>
        The build runs on Tori, so nothing needs installing first. The first run creates a service under a new name of
        its own and writes it to <code>tori.json</code>, so that the next run updates the same service.
      </p>

      <footer>
        <p>
          This is an example run by <a href="https://tori.host/">Tori</a>, in ${LOCATION}. The source is on
          <a href="${SOURCE}">GitHub</a>.
        </p>
      </footer>
    </main>
  </body>
</html>
`
}

/** The app. `now` is a parameter so a test can choose when it started. */
export function createApp({ now = () => Date.now() } = {}) {
  // The page has no part a request can change, so it is written once.
  const home = page(new Date(now()).toISOString())
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.set({
      // Covers the images too: an SVG opened on its own is a document, and
      // this one may run nothing and load nothing.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // The pages on tori.host are the ones meant to be found; this copy is not.
      'X-Robots-Tag': 'noindex',
    })
    next()
  })

  app.get('/healthz', (req, res) => res.set('Cache-Control', 'no-store').type('text/plain').send('ok\n'))
  app.get('/', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(home))
  app.get(/\.svg$/, (req, res, next) => {
    const answer = placeholderFor(req.path, req.query)
    if (answer === null) return next()
    if (answer.error) return res.status(400).set('Cache-Control', 'no-store').type('text/plain').send(`${answer.error}\n`)
    // The same address always draws the same image, so it may be kept as long as a cache likes.
    res.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/svg+xml').send(answer.svg)
  })
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url)), { maxAge: '5m', index: false }))

  app.use((req, res) => res.status(404).type('text/plain').send('Nothing here. How to ask for an image is at /\n'))
  // Express 5 sends a thrown error here. Say little to the visitor and the rest to the log.
  app.use((error, req, res, next) => {
    console.error('request failed:', error)
    if (res.headersSent) return next(error)
    res.status(500).type('text/plain').send('Something went wrong here.\n')
  })
  return app
}

// Started as a program, not imported by the tests. Real paths on both sides,
// so that a start through a symlink still counts as this file.
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
  const server = createApp().listen(port, '0.0.0.0', () => console.log(`misty heron is listening on ${port}`))
  // A napping service is stopped with SIGTERM: finish what is in flight, then leave.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`${signal}: closing`)
      server.close(() => process.exit(0))
      server.closeIdleConnections?.()
    })
  }
}
