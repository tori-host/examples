// The built site, read from dist/ as Tori would serve it. `npm test` builds
// first, so these never pass against a stale build.
//
// What each page should list is worked out here from the Markdown files
// themselves, not from the code that built the pages: a test that asked the
// same functions would agree with them when they are wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brokenLinks, filesUnder, pageProblems, urlOf, xmlProblems } from './check.mjs'
import { CHECK, NAME } from '../src/site.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const SITE = 'https://drift-albatross.tori.cloud'

if (!existsSync(join(dist, 'index.html'))) throw new Error('no dist/index.html: run `npm run build` first, or `npm test`, which builds')

const read = (file) => readFileSync(join(dist, file), 'utf8')

/** The posts as their files say: id, date and tags from the frontmatter. */
const posts = readdirSync(join(root, 'src/content/posts'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => {
    const text = readFileSync(join(root, 'src/content/posts', name), 'utf8')
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)[1]
    const field = (key) => new RegExp(`^${key}: (.*)$`, 'm').exec(front)[1].trim()
    return {
      id: name.replace(/\.md$/, ''),
      title: field('title'),
      date: field('date'),
      tags: field('tags').replace(/^\[|\]$/g, '').split(',').map((tag) => tag.trim()),
    }
  })
const tags = [...new Set(posts.flatMap((post) => post.tags))].sort()

/** The posts a page links to, in the order it lists them. */
const postsListed = (html) => [...html.matchAll(/<a href="\/posts\/([a-z0-9-]+)\/">/g)].map(([, id]) => id)

const pages = filesUnder(dist).filter((file) => file.endsWith('.html'))

test('there are five or six posts, and each has a page with its title', () => {
  assert.ok(posts.length >= 5 && posts.length <= 6, `${posts.length} posts`)
  assert.deepEqual(readdirSync(join(dist, 'posts')).sort(), posts.map((post) => post.id).sort())
  for (const post of posts) {
    assert.ok(read(`posts/${post.id}/index.html`).includes(`>${post.title}</h1>`), post.id)
  }
})

test('the first page lists every post, newest first', () => {
  const newest = [...posts].sort((a, b) => b.date.localeCompare(a.date)).map((post) => post.id)
  assert.deepEqual(postsListed(read('index.html')), newest)
})

test('a page per tag, each listing exactly the posts that carry it', () => {
  assert.deepEqual(readdirSync(join(dist, 'tags')).filter((name) => name !== 'index.html').sort(), tags)
  for (const tag of tags) {
    const expected = posts.filter((post) => post.tags.includes(tag)).map((post) => post.id).sort()
    assert.deepEqual(postsListed(read(`tags/${tag}/index.html`)).sort(), expected, tag)
  }
  const index = read('tags/index.html')
  assert.deepEqual([...index.matchAll(/href="\/tags\/([a-z-]+)\/"/g)].map(([, tag]) => tag), tags)
})

test('the feed is well-formed RSS with an item for every post', () => {
  const feed = read('rss.xml')
  assert.deepEqual(xmlProblems(feed), [])
  assert.match(feed, /<rss version="2\.0">/)
  const items = [...feed.matchAll(/<item>[\s\S]*?<\/item>/g)].map(([item]) => item)
  assert.equal(items.length, posts.length)
  for (const post of posts) {
    const item = items.find((text) => text.includes(`<link>${SITE}/posts/${post.id}/</link>`))
    assert.ok(item, `an item for ${post.id}`)
    assert.ok(item.includes(`<title>${post.title}</title>`), post.id)
  }
})

test('every page says what it is, asks not to be indexed, and runs no JavaScript', () => {
  assert.equal(CHECK, `data-example="${NAME}"`)
  assert.ok(pages.length >= posts.length + tags.length + 4, `${pages.length} pages`)
  for (const page of pages) assert.deepEqual(pageProblems(read(page)), [], urlOf(page))
  // Zero JavaScript output, and not only in the pages: no script file either.
  assert.deepEqual(filesUnder(dist).filter((file) => /\.(m?js|cjs)$/.test(file)), [])
})

test('the about and not-found pages are there', () => {
  assert.match(read('about/index.html'), /<h1 class="post-title">About<\/h1>/)
  // Astro writes the not-found page as 404.html, not 404/index.html.
  assert.match(read('404.html'), /<h1 class="post-title">No page here<\/h1>/)
})

test('every link in every page and in the feed names a file in dist/', () => {
  assert.deepEqual(brokenLinks(dist, SITE), [])
})

// With an adapter, Astro builds a server (dist/client and dist/server), and
// the Tori CLI, seeing one such as @astrojs/node in package.json, would build
// a service instead of publishing files. A static site has neither.
test('no server adapter: the build is files at the top of dist/', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  assert.deepEqual(deps.filter((name) => /^@astrojs\/(node|vercel|netlify|cloudflare|deno)$/.test(name)), [])
  assert.doesNotMatch(readFileSync(join(root, 'astro.config.mjs'), 'utf8'), /\badapter\s*:/)
  assert.ok(!existsSync(join(dist, 'server')) && !existsSync(join(dist, 'client')))
})
