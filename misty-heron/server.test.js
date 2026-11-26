import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { createApp } from './server.js'

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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
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

test('the page explains the service, shows examples, and says it is an example', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    assert.equal(res.headers.get('x-powered-by'), null)
    const html = await res.text()
    assert.match(html, /data-example="misty-heron"/)
    assert.match(html, /an example run by/)
    const images = [...html.matchAll(/<img src="([^"]+\.svg[^"]*)"/g)].map(([, src]) => src.replace(/&amp;/g, '&')).filter((src) => src !== '/favicon.svg')
    assert.ok(images.length >= 3, 'a few examples')
    // Each example the page shows is an image the server draws.
    for (const src of images) assert.equal((await fetch(`${base}${src}`)).status, 200, src)
  })
})

test('an image is an SVG of the size asked for, cached for a long time', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/640x360.svg?bg=162028&fg=f1efe9`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /^image\/svg\+xml/)
    assert.match(res.headers.get('cache-control'), /max-age=31536000/)
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/)
    const svg = await res.text()
    assert.match(svg, /width="640" height="360"/)
    assert.ok(svg.includes('>640 × 360</text>'))
    assert.equal((await fetch(`${base}/1x1.svg`)).status, 200)
    assert.equal((await fetch(`${base}/4000x4000.svg`)).status, 200)
  })
})

test('a size, colour or parameter out of bounds is a 400 that repeats nothing of the request', async () => {
  await withServer({}, async (base) => {
    for (const path of [
      '/0x10.svg',
      '/4001x10.svg',
      '/10x4001.svg',
      '/010x10.svg',
      '/99999999999999999999999x1.svg',
      '/10x10.svg?bg=zzz',
      '/10x10.svg?fg=%23fff',
      '/10x10.svg?bg=fff&bg=000',
      '/10x10.svg?bg[x]=fff',
      '/10x10.svg?text=%3Cscript%3Ealert(1)%3C/script%3E',
      '/10x10.svg?fg=fff%22%20onload%3D%22alert(1)',
    ]) {
      const res = await rawGet(base, path)
      assert.equal(res.status, 400, path)
      assert.match(res.headers['content-type'], /^text\/plain/, path)
      assert.doesNotMatch(res.body, /script|alert|onload|zzz|99999/, path)
      assert.equal(res.headers['x-robots-tag'], 'noindex', path)
    }
  })
})

test('the stylesheet and the icon are served, and anything else is a 404', async () => {
  await withServer({}, async (base) => {
    const css = await fetch(`${base}/style.css`)
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type'), /^text\/css/)
    const icon = await fetch(`${base}/favicon.svg`)
    assert.equal(icon.status, 200)
    assert.doesNotMatch(await icon.text(), / × /)
    for (const path of [
      '/missing',
      '/server.js',
      '/placeholder.js',
      '/package.json',
      '/../server.js',
      '/%2e%2e/server.js',
      '/%2e%2e%2fserver.js',
      '/..%5cserver.js',
      '//[',
      '/10x10.svg/x',
      '/10x10.SVG',
      '/10x.svg',
      '/ax10.svg',
    ]) {
      const res = await rawGet(base, path)
      assert.equal(res.status, 404, path)
      assert.doesNotMatch(res.body, /import express|"dependencies"/, path)
    }
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
  })
})

test('every answer tells search engines to leave this copy alone', async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/`)).text()
    assert.ok(html.includes('<meta name="robots" content="noindex" />'))
    for (const path of ['/', '/10x10.svg', '/0x0.svg', '/style.css', '/favicon.svg', '/healthz', '/missing']) {
      const res = await fetch(`${base}${path}`)
      assert.equal(res.headers.get('x-robots-tag'), 'noindex', path)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path)
    }
  })
})
