// The server against a database that is not one: what each state of the
// database looks like to a visitor, and how a vote is posted. db.test.mjs
// runs the same server code's queries against a real Postgres.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPTIONS, createApp, fromAnotherSite } from './server.mjs'

function fakeDb({ state = 'ready', failVote = false } = {}) {
  const counts = new Map()
  return {
    counts: async () => new Map(counts),
    state: async () => {
      if (state === 'throws') throw new Error('connect ECONNREFUSED')
      return state
    },
    vote: async (id) => {
      if (failVote) throw new Error('connection terminated')
      const count = (counts.get(id) ?? 0) + 1
      counts.set(id, count)
      return count
    },
    votes: (id) => counts.get(id) ?? 0,
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

test('a vote from the page is counted, the browser is sent back, and the bars follow', async () => {
  const db = fakeDb()
  await withServer({ db }, async (base) => {
    for (const option of ['ramen', 'ramen', 'ramen', 'pizza']) {
      const res = await post(base, `/votes/${option}`, { 'Sec-Fetch-Site': 'same-origin' })
      assert.equal(res.status, 303)
      assert.equal(res.headers.get('location'), '/')
    }
    assert.equal(db.votes('ramen'), 3)
    const html = await (await fetch(`${base}/`)).text()
    assert.equal(databaseState(html), 'ready')
    assert.match(html, /data-option="ramen">[\s\S]*?3 votes[\s\S]*?<progress max="4" value="3"[^>]*>75%</)
    assert.match(html, /data-option="pizza">[\s\S]*?1 vote<[\s\S]*?<progress max="4" value="1"/)
    assert.match(html, /data-option="soup">[\s\S]*?0 votes[\s\S]*?<progress max="4" value="0"/)
    assert.match(html, /4 votes today/)
    for (const option of OPTIONS) assert.ok(html.includes(`action="/votes/${option.id}"`), option.id)
    // The page's CSP allows no inline style, so nothing on it may need one.
    assert.doesNotMatch(html, /style="/)
  })
})

test('with no votes yet every bar is empty, not undrawn', async () => {
  await withServer({ db: fakeDb() }, async (base) => {
    const html = await (await fetch(`${base}/`)).text()
    assert.equal(html.match(/<progress max="1" value="0"/g).length, OPTIONS.length)
    assert.match(html, /0 votes today/)
  })
})

test('another site cannot post, and the refusal comes before the cap', async () => {
  const db = fakeDb()
  await withServer({ db, writesPerMinute: 1 }, async (base) => {
    const refused = await post(base, '/votes/pizza', { Origin: 'https://example.com' })
    assert.equal(refused.status, 403)
    assert.equal(db.votes('pizza'), 0)
    // The one write this minute is still there for the page itself.
    assert.equal((await post(base, '/votes/pizza', { 'Sec-Fetch-Site': 'same-origin' })).headers.get('location'), '/')
    assert.equal(db.votes('pizza'), 1)
  })
})

test('the cap, an unknown option and a failed write each say so on the page', async () => {
  let clock = 0
  const db = fakeDb()
  await withServer({ db, writesPerMinute: 1, now: () => clock }, async (base) => {
    await post(base, '/votes/pizza')
    const busy = await post(base, '/votes/pizza')
    assert.equal(busy.headers.get('location'), '/?refused=busy')
    assert.equal(db.votes('pizza'), 1)
    clock += 60_000
    assert.equal((await post(base, '/votes/pizza')).headers.get('location'), '/')
    assert.equal(db.votes('pizza'), 2)
    assert.equal((await post(base, '/votes/caviar')).headers.get('location'), '/?refused=gone')
    const html = await (await fetch(`${base}/?refused=busy`)).text()
    assert.match(html, /limited number of votes a minute/)
    // Only the server's own sentences are shown, never what the address says.
    assert.doesNotMatch(await (await fetch(`${base}/?refused=%3Cscript%3E`)).text(), /<script>/)
  })
  await withServer({ db: fakeDb({ failVote: true }) }, async (base) => {
    assert.equal((await post(base, '/votes/pizza')).headers.get('location'), '/?refused=failed')
    const html = await (await fetch(`${base}/?refused=failed`)).text()
    assert.match(html, /may or may not have been counted\. The results above are what it holds now\./)
  })
  // The write failed and the database has stopped answering since: the page
  // has no results to show, and still has to say the vote may be in.
  await withServer({ db: fakeDb({ state: 'throws' }) }, async (base) => {
    const html = await (await fetch(`${base}/?refused=failed`)).text()
    assert.equal(databaseState(html), 'unreachable')
    assert.match(html, /may or may not have been counted\. Look at the results again once the database answers/)
    assert.doesNotMatch(html, /results above/)
  })
})

test('only POST counts, and paths that are not routes are 404s', async () => {
  await withServer({ db: fakeDb() }, async (base) => {
    assert.equal((await fetch(`${base}/votes/pizza`)).status, 405)
    assert.equal((await post(base, '/')).status, 405)
    for (const path of ['/missing', '/server.mjs', '//[', '/votes/pizza/']) {
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
      await post(base, '/votes/pizza', { 'Sec-Fetch-Site': 'same-origin' }),
    ]) {
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', res.url)
    }
  })
})
