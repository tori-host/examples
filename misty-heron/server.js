// misty heron: an Express server that Tori builds from source. There is no
// Dockerfile: Tori sees `express` in package.json and the `start` script, and
// builds an image that runs `npm start` on port 8080.
import express from 'express'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { birdOfTheDay } from './birds.js'

export const LOCATION = 'Prague, EU'
const SOURCE = 'https://github.com/tori-host/examples/tree/main/misty-heron'

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function page({ day, bird }, startedAt) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>misty heron — an Express server on Tori</title>
    <meta name="description" content="An example Express server run by Tori, built from source without a Dockerfile, in ${LOCATION}." />
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
      <p class="lead">Bird of the day, ${escapeHtml(day)} (UTC):</p>
      <div class="card">
        <h2>${escapeHtml(bird.name)}</h2>
        <p><i>${escapeHtml(bird.latin)}</i></p>
      </div>
      <p>The same answer as JSON: <a href="/api/bird-of-the-day"><code>/api/bird-of-the-day</code></a>.</p>

      <h2>How it runs</h2>
      <ul>
        <li>
          There is no Dockerfile. Tori finds <code>express</code> in <code>package.json</code>, builds an image from the
          source and runs <code>npm start</code>.
        </li>
        <li>
          This page is drawn by the server on every request. When nobody visits for a while the server naps, and the
          next request wakes it, which takes a moment longer than the ones after it.
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

/** The app. `now` is a parameter so a test can choose the day. */
export function createApp({ now = () => Date.now() } = {}) {
  const startedAt = new Date(now()).toISOString()
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.set({
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
  app.get('/', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(page(birdOfTheDay(now()), startedAt)))
  app.get('/api/bird-of-the-day', (req, res) => {
    const { day, bird } = birdOfTheDay(now())
    res.set('Cache-Control', 'no-store').json({ day, ...bird, location: LOCATION })
  })
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url)), { maxAge: '5m', index: false }))

  app.use((req, res) => res.status(404).type('text/plain').send('Nothing here. The bird of the day is at /\n'))
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
