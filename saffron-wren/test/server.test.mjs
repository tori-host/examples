// The production server, as Tori runs it: `npm run build`, then `npm start`
// with PORT set, here to a free port on this machine. Headers set in
// next.config.mjs and proxy.js only exist in a running server, so this is the
// test that says whether they are really sent, on pages, the API, static
// files and 404s alike.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { RECIPES, findRecipe } from '../lib/recipes.js'
import { scaleRecipe } from '../lib/scale.js'

const dir = fileURLToPath(new URL('..', import.meta.url))
// Under `npm test` this is the npm that is running; started by hand, the one on PATH.
const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['npm']
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }

let server
let base

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.on('error', reject)
  })
}

before(async () => {
  const build = spawnSync(npm[0], [...npm.slice(1), 'run', 'build'], { cwd: dir, env, encoding: 'utf8', timeout: 300_000 })
  assert.equal(build.status, 0, `npm run build failed:\n${build.stdout}\n${build.stderr}`)

  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  // Its own process group, so that stopping it stops next as well as npm.
  server = spawn(npm[0], [...npm.slice(1), 'start'], { cwd: dir, env: { ...env, PORT: String(port) }, detached: true })
  let log = ''
  server.stdout.on('data', (chunk) => (log += chunk))
  server.stderr.on('data', (chunk) => (log += chunk))
  for (let i = 0; i < 150; i += 1) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`npm start did not answer on PORT=${port}:\n${log}`)
})

after(() => {
  if (server?.exitCode === null) process.kill(-server.pid, 'SIGTERM')
})

/**
 * A GET with the path sent exactly as written. `fetch` resolves `..` and
 * `%2e%2e` before anything is sent, so a traversal test through it asks for
 * an ordinary path and proves nothing about the server.
 */
function rawGet(path) {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

const nonceOf = (res) => /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '')?.[1]
/** What a reader sees: the page without its scripts, which hold the router's own copy of the URL. */
const visibleText = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')

async function page(path) {
  const res = await fetch(`${base}${path}`)
  return { res, html: await res.text() }
}

function assertHeaders(headers, where) {
  const get = (name) => (typeof headers.get === 'function' ? headers.get(name) : headers[name])
  assert.equal(get('x-robots-tag'), 'noindex', where)
  assert.equal(get('x-content-type-options'), 'nosniff', where)
  assert.equal(get('referrer-policy'), 'strict-origin-when-cross-origin', where)
  assert.equal(get('x-powered-by') ?? null, null, where)
  const policy = get('content-security-policy') ?? ''
  assert.match(policy, /(^|; )default-src 'none'(;|$)/, where)
  assert.match(policy, /(^|; )script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'(;|$)/, where)
  assert.match(policy, /(^|; )frame-ancestors 'none'(;|$)/, where)
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|https?:|\*/, where)
}

test('every answer carries the security headers: pages, API, static files, 404s', async () => {
  const { html } = await page('/')
  const css = /href="(\/_next\/static\/[^"]+\.css)"/.exec(html)?.[1]
  const js = /src="(\/_next\/static\/[^"]+\.js)"/.exec(html)?.[1]
  assert.ok(css && js, 'the page links its stylesheet and scripts')
  const paths = [
    '/',
    '/recipes/shakshuka',
    '/api/recipes/shakshuka?servings=6',
    '/api/recipes/shakshuka?servings=0',
    '/api/recipes/nope',
    '/healthz',
    '/favicon.svg',
    css,
    js,
    '/missing',
    '/recipes/nope',
    '/_next/static/missing.js',
  ]
  for (const path of paths) assertHeaders((await fetch(`${base}${path}`)).headers, path)
  // And a 404 that fetch would never have sent.
  assertHeaders((await rawGet('/_next/static/../../package.json')).headers, 'traversal')
})

test('a static file is served with its own type', async () => {
  const { html } = await page('/')
  const css = /href="(\/_next\/static\/[^"]+\.css)"/.exec(html)[1]
  const res = await fetch(`${base}${css}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/css/)
  assert.match(await res.text(), /--paper/)
  const icon = await fetch(`${base}/favicon.svg`)
  assert.equal(icon.status, 200)
  assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/)
})

test('every script and style on a page carries the nonce of that response, and nothing comes from elsewhere', async () => {
  const nonces = new Set()
  for (const path of ['/', '/recipes/plum-sheet-cake', '/missing', '/recipes/nope']) {
    const { res, html } = await page(path)
    const nonce = nonceOf(res)
    assert.ok(nonce, path)
    nonces.add(nonce)
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    assert.ok(scripts.length > 0, `${path}: a page with no scripts proves nothing here`)
    for (const tag of [...scripts, ...(html.match(/<style\b[^>]*>/g) ?? [])]) {
      assert.ok(tag.includes(` nonce="${nonce}"`), `${path}: ${tag}`)
    }
    // An inline style attribute cannot carry a nonce, and style-src would block it.
    assert.doesNotMatch(html, /<[^>]+\sstyle="/, path)
    assert.doesNotMatch(html, /<(script|link|img)\b[^>]*\s(src|href)="(https?:)?\/\//, `${path}: a resource from another origin`)
  }
  assert.equal(nonces.size, 4, 'a fresh nonce for every response')
})

test('the list page says what it is and links every recipe', async () => {
  const { res, html } = await page('/')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/html/)
  assert.ok(html.includes('<body data-example="saffron-wren">'))
  assert.ok(html.includes('<meta name="robots" content="noindex"/>'))
  assert.ok(html.includes('an example run by <a href="https://tori.host/">Tori</a>'))
  assert.ok(html.includes('Prague, EU'))
  assert.ok(html.includes('href="https://github.com/tori-host/examples/tree/main/saffron-wren"'))
  for (const recipe of RECIPES) assert.ok(html.includes(`href="/recipes/${recipe.slug}"`), recipe.slug)
})

test('a recipe page is drawn on the server with the amounts the module computes', async () => {
  for (const recipe of RECIPES) {
    const { res, html } = await page(`/recipes/${recipe.slug}`)
    assert.equal(res.status, 200, recipe.slug)
    const text = visibleText(html)
    assert.ok(text.includes(`<h2 class="title">${recipe.title}</h2>`), recipe.slug)
    assert.ok(text.includes('data-example="saffron-wren"'), recipe.slug)
    for (const ingredient of scaleRecipe(recipe, recipe.servings).ingredients) {
      assert.ok(text.includes(`<td class="amount">${ingredient.display}</td>`), `${recipe.slug}: ${ingredient.name}`)
    }
  }
})

test('the API answers JSON the module agrees with, and refuses what it should', async () => {
  const res = await fetch(`${base}/api/recipes/shakshuka?servings=6&units=us`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^application\/json/)
  assert.deepEqual(await res.json(), scaleRecipe(findRecipe('shakshuka'), 6, 'us'))
  for (const servings of ['0', '49', 'abc', '2.5', '']) {
    const refused = await fetch(`${base}/api/recipes/shakshuka?servings=${servings}`)
    assert.equal(refused.status, 400, servings)
    assert.match((await refused.json()).error, /from 1 to 48/)
  }
  assert.equal((await fetch(`${base}/api/recipes/nope?servings=4`)).status, 404)
  assert.equal((await fetch(`${base}/api/recipes/constructor`)).status, 404)
  // Nothing here changes state, so nothing takes a POST.
  assert.equal((await fetch(`${base}/api/recipes/shakshuka`, { method: 'POST' })).status, 405)
})

test('an unknown path or recipe is a whole 404 page that repeats nothing from the URL', async () => {
  for (const path of ['/missing-zqxv', '/recipes/zqxv', '/recipes/Shakshuka', '/recipes/zqxv%3Cb%3E', '/recipes/%E0%A4%A']) {
    const { res, html } = await page(path)
    assert.equal(res.status, 404, path)
    assert.match(res.headers.get('content-type'), /^text\/html/, path)
    // Drawn on the server, not an empty shell the browser has to fill in.
    assert.doesNotMatch(html, /id="__next_error__"/, path)
    assert.ok(html.includes('data-example="saffron-wren"'), path)
    assert.ok(html.includes('<meta name="robots" content="noindex"/>'), path)
    assert.ok(visibleText(html).includes('There is nothing here.'), path)
    assert.doesNotMatch(visibleText(html), /zqxv|Shakshuka/, path)
  }
})

test('the server never serves its own source', async () => {
  for (const path of [
    '/package.json',
    '/package-lock.json',
    '/lib/scale.js',
    '/proxy.js',
    '/next.config.mjs',
    '/app/layout.jsx',
    '/.next/BUILD_ID',
    '/_next/server/app/page.js',
    '/_next/static/../../package.json',
    '/_next/static/%2e%2e/%2e%2e/package.json',
    '/public/favicon.svg',
  ]) {
    const res = await rawGet(path)
    assert.equal(res.status, 404, path)
    assert.doesNotMatch(res.body, /"dependencies"|export function|NEXT_TELEMETRY/, path)
  }
})

test('/healthz answers ok', async () => {
  const res = await fetch(`${base}/healthz`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/plain/)
  assert.equal(await res.text(), 'ok\n')
})
