// The server against a database that is not one: what each state of the
// database looks like to a visitor, and how a sighting is posted. db.test.mjs
// runs the same server code's queries against a real Postgres.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BIRDS, createApp, fromAnotherSite } from './server.mjs'

function fakeDb({ state = 'ready', failRecord = false } = {}) {
  const counts = new Map()
  return {
    counts: async () => new Map(counts),
    state: async () => {
      if (state === 'throws') throw new Error('connect ECONNREFUSED')
      return state
    },
    record: async (id) => {
      if (failRecord) throw new Error('connection terminated')
      const count = (counts.get(id)?.count ?? 0) + 1
      counts.set(id, { count, firstSeen: new Date(0).toISOString() })
      return count
    },
    seen: (id) => counts.get(id)?.count ?? 0,
  }
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

const post = (base, path, headers = {}) => fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers })
const databaseState = (html) => /data-database="([a-z]+)"/.exec(html)?.[1]

test('without a database the page runs and says how to add one', async () => {
  await withServer({ db: null }, async (base) => {
    const html = await (await fetch(`${base}/`)).text()
    assert.equal(databaseState(html), 'missing')
    assert.match(html, /npx tori\.host db create/)
    assert.match(html, /an example run by/)
  })
})

test('a database without the table, and one that does not answer, are told apart', async () => {
  await withServer({ db: fakeDb({ state: 'unmigrated' }) }, async (base) => {
    const html = await (await fetch(`${base}/`)).text()
    assert.equal(databaseState(html), 'unmigrated')
    assert.match(html, /release command/)
  })
  await withServer({ db: fakeDb({ state: 'throws' }) }, async (base) => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.equal(databaseState(await res.text()), 'unreachable')
  })
})

test('a sighting from the page is counted and the browser is sent back', async () => {
  const db = fakeDb()
  await withServer({ db }, async (base) => {
    const res = await post(base, '/sightings/common-starling', { 'Sec-Fetch-Site': 'same-origin' })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/')
    assert.equal(db.seen('common-starling'), 1)
    const html = await (await fetch(`${base}/`)).text()
    assert.equal(databaseState(html), 'ready')
    assert.match(html, /data-bird="common-starling">[\s\S]*?aria-label="1 sighting">1</)
    for (const bird of BIRDS) assert.ok(html.includes(`action="/sightings/${bird.id}"`), bird.id)
  })
})

test('another site cannot post, and the refusal comes before the cap', async () => {
  const db = fakeDb()
  await withServer({ db, writesPerMinute: 1 }, async (base) => {
    const refused = await post(base, '/sightings/great-tit', { Origin: 'https://example.com' })
    assert.equal(refused.status, 403)
    assert.equal(db.seen('great-tit'), 0)
    // The one write this minute is still there for the page itself.
    assert.equal((await post(base, '/sightings/great-tit', { 'Sec-Fetch-Site': 'same-origin' })).headers.get('location'), '/')
    assert.equal(db.seen('great-tit'), 1)
  })
})

test('the cap, an unknown bird and a failed write each say so on the page', async () => {
  let clock = 0
  const db = fakeDb()
  await withServer({ db, writesPerMinute: 1, now: () => clock }, async (base) => {
    await post(base, '/sightings/great-tit')
    const busy = await post(base, '/sightings/great-tit')
    assert.equal(busy.headers.get('location'), '/?refused=busy')
    assert.equal(db.seen('great-tit'), 1)
    clock += 60_000
    assert.equal((await post(base, '/sightings/great-tit')).headers.get('location'), '/')
    assert.equal(db.seen('great-tit'), 2)
    assert.equal((await post(base, '/sightings/dodo')).headers.get('location'), '/?refused=gone')
    const html = await (await fetch(`${base}/?refused=busy`)).text()
    assert.match(html, /limited number of sightings a minute/)
    // Only the server's own sentences are shown, never what the address says.
    assert.doesNotMatch(await (await fetch(`${base}/?refused=%3Cscript%3E`)).text(), /<script>/)
  })
  await withServer({ db: fakeDb({ failRecord: true }) }, async (base) => {
    assert.equal((await post(base, '/sightings/great-tit')).headers.get('location'), '/?refused=failed')
    const html = await (await fetch(`${base}/?refused=failed`)).text()
    assert.match(html, /may or may not have been counted\. The count above is what it holds now\./)
  })
  // The write failed and the database has stopped answering since: the page
  // has no count to show, and still has to say the sighting may be in.
  await withServer({ db: fakeDb({ state: 'throws' }) }, async (base) => {
    const html = await (await fetch(`${base}/?refused=failed`)).text()
    assert.equal(databaseState(html), 'unreachable')
    assert.match(html, /may or may not have been counted\. Look at the count again once the database answers/)
    assert.doesNotMatch(html, /count above/)
  })
})

test('only POST counts, and paths that are not routes are 404s', async () => {
  await withServer({ db: fakeDb() }, async (base) => {
    assert.equal((await fetch(`${base}/sightings/great-tit`)).status, 405)
    assert.equal((await post(base, '/')).status, 405)
    for (const path of ['/missing', '/server.mjs', '//[', '/sightings/great-tit/']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404, path)
    }
    assert.equal((await fetch(`${base}/style.css`)).status, 200)
    assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok\n')
  })
})

test('a post from another site is recognised by either header the browser sends', () => {
  assert.equal(fromAnotherSite({ 'sec-fetch-site': 'cross-site' }), true)
  assert.equal(fromAnotherSite({ 'sec-fetch-site': 'same-site' }), true)
  assert.equal(fromAnotherSite({ 'sec-fetch-site': 'same-origin', origin: 'https://example.com' }), false)
  assert.equal(fromAnotherSite({ origin: 'https://example.com', host: 'mossy-starling.tori.cloud' }), true)
  assert.equal(fromAnotherSite({ origin: 'https://mossy-starling.tori.cloud', host: 'mossy-starling.tori.cloud' }), false)
  assert.equal(fromAnotherSite({ origin: 'null', host: 'mossy-starling.tori.cloud' }), true)
  assert.equal(fromAnotherSite({ host: 'mossy-starling.tori.cloud' }), false)
})

test('every answer tells search engines to leave this copy alone', async () => {
  await withServer({ db: fakeDb() }, async (base) => {
    const html = await (await fetch(`${base}/`)).text()
    assert.ok(html.includes('<meta name="robots" content="noindex" />'))
    for (const res of [
      await fetch(`${base}/`),
      await fetch(`${base}/style.css`),
      await fetch(`${base}/missing`),
      await post(base, '/sightings/great-tit', { 'Sec-Fetch-Site': 'same-origin' }),
    ]) {
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', res.url)
    }
  })
})
