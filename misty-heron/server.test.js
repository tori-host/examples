import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { BIRDS, birdOfTheDay } from './birds.js'
import { createApp } from './server.js'

const DAY = 24 * 60 * 60 * 1000

/**
 * A GET with the path sent exactly as written. `fetch` resolves `..` and
 * `%2e%2e` before anything is sent, so a traversal test through it asks for
 * an ordinary path and proves nothing about the server.
 */
function rawGet(base, path) {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function withServer(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run(base)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('one UTC day has one bird, and the next day another', () => {
  const morning = Date.UTC(2026, 10, 26, 0, 0, 1)
  const evening = Date.UTC(2026, 10, 26, 23, 59, 59)
  assert.deepEqual(birdOfTheDay(morning), birdOfTheDay(evening))
  assert.equal(birdOfTheDay(morning).day, '2026-11-26')
  assert.notEqual(birdOfTheDay(morning + DAY).bird.id, birdOfTheDay(morning).bird.id)
})

test('every bird comes round, and before the epoch too', () => {
  const seen = new Set()
  for (let d = 0; d < BIRDS.length; d += 1) seen.add(birdOfTheDay(Date.UTC(2026, 0, 1) + d * DAY).bird.id)
  assert.equal(seen.size, BIRDS.length)
  assert.ok(BIRDS.includes(birdOfTheDay(-5 * DAY).bird))
})

test('the page names the bird of the day and says it is an example', async () => {
  const now = () => Date.UTC(2026, 10, 26, 12)
  await withServer({ now }, async (base) => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    assert.equal(res.headers.get('x-powered-by'), null)
    const html = await res.text()
    assert.match(html, /data-example="misty-heron"/)
    assert.ok(html.includes(birdOfTheDay(now()).bird.name))
    assert.match(html, /an example run by/)
  })
})

test('the API answers the same bird as JSON', async () => {
  const now = () => Date.UTC(2026, 10, 26, 12)
  await withServer({ now }, async (base) => {
    const res = await fetch(`${base}/api/bird-of-the-day`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.day, '2026-11-26')
    assert.equal(body.id, birdOfTheDay(now()).bird.id)
    assert.equal(body.location, 'Prague, EU')
  })
})

test('the stylesheet and the icon are served, and anything else is a 404', async () => {
  await withServer({}, async (base) => {
    const css = await fetch(`${base}/style.css`)
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type'), /^text\/css/)
    assert.equal((await fetch(`${base}/favicon.svg`)).status, 200)
    for (const path of ['/missing', '/server.js', '/../server.js', '/%2e%2e/server.js', '/%2e%2e%2fserver.js', '/..%5cserver.js', '//[']) {
      const res = await rawGet(base, path)
      assert.equal(res.status, 404, path)
      assert.doesNotMatch(res.body, /import express/, path)
    }
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
  })
})

test('every answer tells search engines to leave this copy alone', async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/`)).text()
    assert.ok(html.includes('<meta name="robots" content="noindex" />'))
    for (const path of ['/', '/api/bird-of-the-day', '/style.css', '/healthz', '/missing']) {
      assert.equal((await fetch(`${base}${path}`)).headers.get('x-robots-tag'), 'noindex', path)
    }
  })
})
