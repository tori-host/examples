// Each check that site.test.mjs runs over dist/, shown failing on an input
// that breaks the rule it is there for. Without these, a check that matched
// nothing would pass every build.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { brokenLinks, fileFor, pageProblems, xmlProblems } from './check.mjs'
import { FOOTER, ROBOTS } from '../src/site.mjs'

const SITE = 'https://drift-albatross.tori.cloud'
const good = `<!DOCTYPE html><html lang="en"><head>${ROBOTS}</head><body data-example="drift-albatross"><main><p>${FOOTER}</p></main></body></html>`

test('a page that says everything passes, and each missing piece is caught', () => {
  assert.deepEqual(pageProblems(good), [])
  assert.deepEqual(pageProblems(good.replace(ROBOTS, '<meta name="robots" content="all" />')), ['missing the noindex meta'])
  assert.deepEqual(pageProblems(good.replace('data-example="drift-albatross"', 'data-example="other"')), ['missing the example marker on <body>'])
  assert.deepEqual(pageProblems(good.replace('Prague, EU', 'somewhere')), ['missing the location'])
  assert.deepEqual(pageProblems(good.replace('/tree/main/drift-albatross', '/tree/main/other')), ['missing a link to its source'])
})

test('any script is caught: an element of any type, or a handler attribute', () => {
  assert.deepEqual(pageProblems(good.replace('</main>', '</main><script type="module" src="/_astro/x.js"></script>')), ['a <script> element'])
  assert.deepEqual(pageProblems(good.replace('</main>', '<SCRIPT>1</SCRIPT></main>')), ['a <script> element'])
  assert.deepEqual(pageProblems(good.replace('<main>', '<main onclick="x()">')), ['an inline event handler'])
})

test('a feed that is not well formed is caught', () => {
  const feed = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>a &amp; b</title><item><title>x</title></item></channel></rss>'
  assert.deepEqual(xmlProblems(feed), [])
  assert.equal(xmlProblems(feed.replace('</item>', ''))[0], '</channel> closes <item>')
  assert.deepEqual(xmlProblems(feed.replace('&amp;', '&')), ['a bare &'])
  assert.deepEqual(xmlProblems(feed.replace('<?xml version="1.0" encoding="UTF-8"?>', '')), ['no XML declaration'])
  assert.deepEqual(xmlProblems(`${feed}<rss></rss>`), ['2 root elements'])
})

test('a link is resolved by Tori’s rules, without the fallback to the first page', (t) => {
  const dist = mkdtempSync(join(tmpdir(), 'drift-albatross-links-'))
  t.after(() => rmSync(dist, { recursive: true, force: true }))
  const put = (file, text = '') => {
    mkdirSync(dirname(join(dist, file)), { recursive: true })
    writeFileSync(join(dist, file), text)
  }
  put('posts/real/index.html')
  put('style.css')
  put('rss.xml', `<?xml version="1.0"?><rss><channel><link>${SITE}/posts/real/</link><link>${SITE}/posts/gone/</link></channel></rss>`)
  put(
    'index.html',
    [
      '<a href="/posts/real/">', // a directory: its index.html
      '<a href="/posts/real">', // the same, without the slash
      '<a href="posts/real/#top">', // relative, with a fragment
      '<link href="/style.css?v=1">', // a file, with a query
      '<a href="https://tori.host/">', // another site: not checked
      '<a href="#main">', // this page
      '<a href="/posts/missing/">', // broken
      '<a href="/posts/missing">', // broken, though Tori would answer it with index.html
      '<img src="/missing.png">', // broken
      `<a href="${SITE}/nowhere/">`, // broken, though written as an absolute address
    ].join(''),
  )
  assert.deepEqual(brokenLinks(dist, SITE), [
    '/ -> /posts/missing/',
    '/ -> /posts/missing',
    '/ -> /missing.png',
    `/ -> ${SITE}/nowhere/`,
    `/rss.xml -> ${SITE}/posts/gone/`,
  ])
  // The root, a directory name that looks like a version, and a way out of dist/.
  assert.equal(fileFor(dist, '/'), 'index.html')
  assert.equal(fileFor(dist, '/posts/real.0'), null)
  assert.equal(fileFor(dist, '/../index.html'), null)
})
