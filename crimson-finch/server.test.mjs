// What the demo app promises, asked of the running server over HTTP.
//
// Each case names what it would catch. The ones that matter most are two of
// the decisions at the top of server.mjs: nothing typed by a visitor is shown
// to another (there is no input at all, and an unknown bird is refused, not
// created), and the write cap holds for the whole process and is not lifted
// by a header a client can set.
//
// Not tested here: that a request body is not kept in memory. Client and
// server share this process, so a memory reading would measure the test's own
// copy of what it sent. The code drains the request and attaches no reader.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { connect } from 'node:net'
import { test } from 'node:test'
import { CATALOGUE, LOCATION, MAX_HEARTS, SPOTTED_AT_START, createApp, heartLabel, startedText } from './server.mjs'

async function start(options) {
  const server = createApp(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    get: (path, init) => fetch(origin + path, init),
    post: (path, init) => fetch(origin + path, { method: 'POST', ...init }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('the page is the homepage demo: its three birds, their hearts, and where it runs', async () => {
  const app = await start()
  try {
    const response = await app.get('/')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/html/)
    const html = await response.text()
    for (const bird of CATALOGUE.slice(0, SPOTTED_AT_START)) {
      assert.ok(html.includes(bird.name), `${bird.name} is on the page`)
      assert.match(html, new RegExp(`data-bird="${bird.id}"[\\s\\S]*?<span class="count">${bird.hearts}</span>`))
    }
    // A bird that has not been logged is not on the page yet.
    assert.ok(!html.includes(CATALOGUE[SPOTTED_AT_START].name))
    assert.ok(html.includes(LOCATION))
    assert.ok(html.includes('https://tori.host/'))
    // It is a demo: it must not compete with the real pages in a search index.
    assert.ok(html.includes('<meta name="robots" content="noindex" />'))
  } finally {
    await app.close()
  }
})

test('nothing on the page comes from outside the app, and the policy says so', async () => {
  const app = await start()
  try {
    const response = await app.get('/')
    const csp = response.headers.get('content-security-policy')
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /script-src 'self'/)
    assert.match(csp, /form-action 'none'/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    // `no-referrer` would make a browser send `Origin: null` on this page's
    // own clicks, and the cross-site check refuses that.
    assert.equal(response.headers.get('referrer-policy'), 'same-origin')
    const html = await response.text()
    // Every src/href that loads something is a path of this app. The one
    // absolute address is a link a person follows, not something loaded.
    const loaded = [...html.matchAll(/<(?:script|link|img)[^>]*(?:src|href)="([^"]*)"/g)].map((m) => m[1])
    assert.ok(loaded.length >= 3)
    for (const address of loaded) assert.match(address, /^\/[a-z.]+$/)
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), 'no inline script')
    for (const path of loaded) assert.equal((await app.get(path)).status, 200, `${path} is served`)
  } finally {
    await app.close()
  }
})

test('a heart is counted by the server, and the next reader sees it', async () => {
  const app = await start()
  try {
    const first = CATALOGUE[0]
    const response = await app.post(`/api/birds/${first.id}/heart`)
    assert.equal(response.status, 200)
    const answer = await response.json()
    assert.equal(answer.id, first.id)
    assert.equal(answer.hearts, first.hearts + 1)
    // The answer carries the whole list as the server holds it: that, and not
    // a number kept in the browser, is what the page draws.
    assert.equal(answer.birds.find((b) => b.id === first.id).hearts, first.hearts + 1)
    assert.equal(answer.birds.length, SPOTTED_AT_START)
    const { birds } = await (await app.get('/api/birds')).json()
    assert.equal(birds.find((b) => b.id === first.id).hearts, first.hearts + 1)
    assert.match(await (await app.get('/')).text(), new RegExp(`<span class="count">${first.hearts + 1}</span>`))
  } finally {
    await app.close()
  }
})

test('a bird is logged from the list, in order, until none is left', async () => {
  const app = await start({ writesPerMinute: 1000 })
  try {
    const remaining = CATALOGUE.slice(SPOTTED_AT_START)
    for (const [i, expected] of remaining.entries()) {
      const response = await app.post('/api/birds')
      assert.equal(response.status, 201)
      const body = await response.json()
      assert.equal(body.bird.id, expected.id)
      assert.equal(body.left, remaining.length - i - 1)
    }
    const none = await app.post('/api/birds')
    assert.equal(none.status, 409)
    // A page that was opened before the others logged their birds learns the
    // full list from the refusal itself.
    const refusal = await none.json()
    assert.equal(refusal.left, 0)
    assert.deepEqual(refusal.birds.map((b) => b.id), CATALOGUE.map((b) => b.id))
    const { birds, left } = await (await app.get('/api/birds')).json()
    assert.equal(left, 0)
    assert.deepEqual(birds.map((b) => b.id), CATALOGUE.map((b) => b.id))
    // The button stays a button: a full list answers the click in words (the
    // 409 above), because the page cannot know when a napping server has made
    // room again.
    assert.equal(refusal.error, 'Every bird is on the list.')
    assert.match(await (await app.get('/')).text(), /<button id="log" type="button">\+ log a bird<\/button>/)
  } finally {
    await app.close()
  }
})

test('a visitor cannot put words on the page', async () => {
  const app = await start()
  try {
    const before = await (await app.get('/api/birds')).json()
    // A body is ignored: the bird that gets logged is the catalogue's next one.
    const withBody = await app.post('/api/birds', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '<script>alert(1)</script>', id: 'visit-example-dot-com' }),
    })
    assert.equal((await withBody.json()).bird.id, CATALOGUE[SPOTTED_AT_START].id)
    // A bird that is not on the list cannot be given a heart into existence...
    const stranger = await app.post('/api/birds/visit-example-dot-com/heart')
    assert.equal(stranger.status, 404)
    // ...and the refusal says what the list is, without the stranger in it.
    const listed = (await stranger.json()).birds.map((b) => b.id)
    assert.deepEqual(listed, CATALOGUE.slice(0, SPOTTED_AT_START + 1).map((b) => b.id))
    // ...nor can one that is in the catalogue but has not been logged yet.
    assert.equal((await app.post(`/api/birds/${CATALOGUE.at(-1).id}/heart`)).status, 404)
    // An id outside the pattern is not even a route.
    assert.equal((await app.post('/api/birds/%3Cscript%3E/heart')).status, 404)
    const after = await (await app.get('/api/birds')).json()
    assert.equal(after.birds.length, before.birds.length + 1)
    const html = await (await app.get('/')).text()
    assert.ok(!html.includes('visit-example') && !html.includes('alert(1)'))
    for (const bird of after.birds) assert.ok(CATALOGUE.some((c) => c.id === bird.id && c.name === bird.name))
  } finally {
    await app.close()
  }
})

test('the write cap holds for the whole process, whatever the client says of itself', async () => {
  let clock = 1_000_000
  const app = await start({ writesPerMinute: 3, now: () => clock })
  try {
    const id = CATALOGUE[0].id
    for (let i = 0; i < 3; i += 1) assert.equal((await app.post(`/api/birds/${id}/heart`)).status, 200)
    // The fourth is refused, also from "another address".
    for (const headers of [{}, { 'x-forwarded-for': '203.0.113.9' }, { 'x-real-ip': '198.51.100.7' }]) {
      const refused = await app.post(`/api/birds/${id}/heart`, { headers })
      assert.equal(refused.status, 429)
      assert.equal(refused.headers.get('retry-after'), '60')
    }
    assert.equal((await app.post('/api/birds')).status, 429)
    // Reading is not a write: the page still answers.
    assert.equal((await app.get('/')).status, 200)
    const { birds } = await (await app.get('/api/birds')).json()
    assert.equal(birds[0].hearts, CATALOGUE[0].hearts + 3)
    // The control: a minute later the cap has reset, so the 429 was the cap.
    clock += 60_000
    assert.equal((await app.post(`/api/birds/${id}/heart`)).status, 200)
  } finally {
    await app.close()
  }
})

test('hearts stop at the ceiling', async () => {
  const first = CATALOGUE[0]
  const ceiling = first.hearts + 3
  const app = await start({ writesPerMinute: 1000, maxHearts: ceiling })
  try {
    const seen = []
    for (let i = 0; i < 6; i += 1) seen.push((await (await app.post(`/api/birds/${first.id}/heart`)).json()).hearts)
    assert.deepEqual(seen, [ceiling - 2, ceiling - 1, ceiling, ceiling, ceiling, ceiling])
    assert.ok(MAX_HEARTS >= 1000, 'the real ceiling is far above what a page shows')
  } finally {
    await app.close()
  }
})

test('methods and addresses the app does not have are refused as such', async () => {
  const app = await start()
  try {
    assert.equal((await app.get('/healthz')).status, 200)
    assert.equal((await app.get('/', { method: 'HEAD' })).status, 200)
    assert.equal((await app.get('/nope')).status, 404)
    assert.equal((await app.get('/../server.mjs')).status, 404)
    assert.equal((await app.get('/public/app.css')).status, 404)
    const put = await app.get('/api/birds', { method: 'PUT' })
    assert.equal(put.status, 405)
    assert.equal(put.headers.get('allow'), 'GET, HEAD, POST')
    const getHeart = await app.get(`/api/birds/${CATALOGUE[0].id}/heart`)
    assert.equal(getHeart.status, 405)
    assert.equal(getHeart.headers.get('allow'), 'POST')
    assert.equal((await app.post('/')).status, 405)
    // Reading the list with GET did not log a bird or count a heart.
    const { birds } = await (await app.get('/api/birds')).json()
    assert.equal(birds.length, SPOTTED_AT_START)
    assert.equal(birds[0].hearts, CATALOGUE[0].hearts)
  } finally {
    await app.close()
  }
})

/** One raw request, as bytes: what `fetch` would never send. Resolves with the status line. */
function raw(origin, requestTarget) {
  const { hostname, port } = new URL(origin)
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(`GET ${requestTarget} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)
    })
    let answer = ''
    socket.on('data', (chunk) => (answer += chunk))
    socket.on('end', () => resolve(answer.split('\r\n', 1)[0]))
    socket.on('error', reject)
    // A server that died on the request never answers it. Without this the
    // test would wait for ever instead of failing, which in a pipeline is a
    // job timeout an hour later rather than a red test now.
    socket.setTimeout(2000, () => socket.destroy(new Error(`no answer to GET ${requestTarget} within 2 s`)))
  })
}

test('a request target the URL parser rejects is one more 404, and the server is still there', async () => {
  // `new URL('//[', base)` throws. The first version of the server parsed the
  // target that way inside the request listener, so this one request was an
  // uncaught exception and the end of the process.
  assert.throws(() => new URL('//[', 'http://localhost'))
  const app = await start()
  try {
    await app.post(`/api/birds/${CATALOGUE[0].id}/heart`)
    for (const target of ['//[', '//[/api/birds', '/%', '/\\', 'http://[/']) {
      const status = await raw(app.origin, target)
      assert.match(status, /^HTTP\/1\.1 (400|404) /, `${target} -> ${status}`)
    }
    // The control: the server answers the next visitor, and still holds the
    // heart given before. A restarted process would have forgotten it.
    const { birds } = await (await app.get('/api/birds')).json()
    assert.equal(birds[0].hearts, CATALOGUE[0].hearts + 1)
    // A query string is not part of the path.
    assert.equal((await app.get('/?utm_source=homepage')).status, 200)
    assert.equal((await app.get('/api/birds?x=//[')).status, 200)
    assert.match(await raw(app.origin, '/?%%%'), /^HTTP\/1\.1 200 /)
  } finally {
    await app.close()
  }
})

test('a heart button says its count to someone who cannot see it, and a click is confirmed in words', async () => {
  const app = await start()
  try {
    const first = CATALOGUE[0]
    // In the HTML the server sends: the label names the action and the count.
    const html = await (await app.get('/')).text()
    assert.ok(html.includes(`aria-label="Give ${first.name} a heart. It has ${first.hearts} hearts."`))
    assert.match(html, /<p id="notice" role="status" aria-live="polite"/)
    // In the list the script draws from: the same words, from the same function.
    const before = await (await app.get('/api/birds')).json()
    for (const bird of before.birds) assert.equal(bird.heartLabel, heartLabel(bird))
    // After a click: the new count is in the label and in what is announced.
    const answer = await (await app.post(`/api/birds/${first.id}/heart`)).json()
    assert.equal(answer.said, `${first.name} has ${first.hearts + 1} hearts.`)
    assert.equal(answer.birds[0].heartLabel, `Give ${first.name} a heart. It has ${first.hearts + 1} hearts.`)
    // One is one: a newly logged bird has no hearts, then a single heart.
    const logged = await (await app.post('/api/birds')).json()
    assert.equal(logged.said, `${logged.bird.name} is on the list.`)
    assert.match(logged.birds.at(-1).heartLabel, /It has 0 hearts\.$/)
    const one = await (await app.post(`/api/birds/${logged.bird.id}/heart`)).json()
    assert.equal(one.said, `${logged.bird.name} has 1 heart.`)
  } finally {
    await app.close()
  }
})

test('the start time on the page is the one the list is sent with, in the same words', async () => {
  // The footer explains the counts by when the server started, and the script
  // redraws the list from a server that may be newer than the page. It can
  // only keep the two in step if it is given the start time and has an
  // element to put it in.
  const at = Date.UTC(2026, 10, 24, 8, 5, 9)
  const app = await start({ now: () => at })
  try {
    const html = await (await app.get('/')).text()
    assert.ok(html.includes('<time id="started" datetime="2026-11-24T08:05:09.000Z">2026-11-24 08:05:09 UTC</time>'))
    const view = await (await app.get('/api/birds')).json()
    assert.equal(view.startedAt, '2026-11-24T08:05:09.000Z')
    assert.equal(view.startedText, startedText(view.startedAt))
    assert.equal(view.startedText, '2026-11-24 08:05:09 UTC')
    // Every write carries it too: a click is how most pages learn of a restart.
    const heart = await (await app.post(`/api/birds/${CATALOGUE[0].id}/heart`)).json()
    assert.equal(heart.startedText, view.startedText)
    // And the notice can take focus when the control that had it disappears.
    assert.ok(html.includes('<p id="notice" role="status" aria-live="polite" tabindex="-1"></p>'))
  } finally {
    await app.close()
  }
})

test('a click sent by another site is refused, changes nothing and does not spend the cap', async () => {
  const app = await start({ writesPerMinute: 2 })
  try {
    const id = CATALOGUE[0].id
    const host = new URL(app.origin).host
    const foreign = [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://example.com' },
      { origin: 'null' },
      // What the browser says of itself wins over an Origin a page cannot forge anyway.
      { 'sec-fetch-site': 'cross-site', origin: `http://${host}` },
    ]
    for (const headers of foreign) {
      for (const path of [`/api/birds/${id}/heart`, '/api/birds']) {
        const refused = await app.post(path, { headers })
        assert.equal(refused.status, 403, `${JSON.stringify(headers)} ${path}`)
      }
    }
    // Ten refusals later nothing has changed...
    const { birds } = await (await app.get('/api/birds')).json()
    assert.equal(birds.length, SPOTTED_AT_START)
    assert.equal(birds[0].hearts, CATALOGUE[0].hearts)
    // ...and the cap of two is still whole: the page's own clicks, and a
    // client that is not a browser, are counted and answered.
    assert.equal((await app.post(`/api/birds/${id}/heart`, { headers: { 'sec-fetch-site': 'same-origin', origin: `http://${host}` } })).status, 200)
    assert.equal((await app.post(`/api/birds/${id}/heart`)).status, 200)
    // The control: the third is the cap, so the two above really were counted.
    assert.equal((await app.post(`/api/birds/${id}/heart`, { headers: { origin: `http://${host}` } })).status, 429)
    // Reading is not a write: another site may link to the page and it loads.
    assert.equal((await app.get('/', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 200)
  } finally {
    await app.close()
  }
})

test('every answer, not only the page, asks not to be indexed', async () => {
  const app = await start()
  try {
    for (const path of ['/', '/api/birds', '/app.js', '/healthz', '/nope']) {
      assert.equal((await app.get(path)).headers.get('x-robots-tag'), 'noindex', path)
    }
  } finally {
    await app.close()
  }
})
