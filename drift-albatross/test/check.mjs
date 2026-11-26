// The checks the tests run over dist/, as functions that take text or a
// directory and return what is wrong with it. Kept apart from the tests so
// that check.test.mjs can feed each one a broken input and see it caught:
// a check that has never been seen to fail is not known to check anything.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CHECK, ROBOTS, SOURCE } from '../src/site.mjs'

/** Every file under `dir`, as paths relative to it with forward slashes. */
export function filesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(path).map((p) => `${entry.name}/${p}`))
    else out.push(entry.name)
  }
  return out.sort()
}

/** The address a built file is served at: posts/x/index.html is /posts/x/. */
export function urlOf(file) {
  return `/${file}`.replace(/(^|\/)index\.html$/, '$1')
}

/** What every page has to say, and what none may carry. */
export function pageProblems(html) {
  const problems = []
  const needs = {
    'the noindex meta': ROBOTS,
    'the example marker on <body>': `<body ${CHECK}`,
    'the words "an example run by"': 'an example run by',
    'a link to Tori': '<a href="https://tori.host/">',
    'the location': 'Prague, EU',
    'a link to its source': `<a href="${SOURCE}">`,
  }
  for (const [what, needle] of Object.entries(needs)) {
    if (!html.includes(needle)) problems.push(`missing ${what}`)
  }
  // Zero JavaScript is the promise: no script element of any type, and no
  // handler attribute, which is a script without the element.
  if (/<script\b/i.test(html)) problems.push('a <script> element')
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) problems.push('an inline event handler')
  return problems
}

/** Every href and src in a page, as written. */
export function linksIn(html) {
  return [...html.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/gi)].map(([, value]) => value.replaceAll('&amp;', '&'))
}

/**
 * The file in `dist` a path is answered from, or null. These are Tori's
 * rules for a static site: a path ending in a slash is that directory's
 * index.html; a path whose last part has an extension is that file; any
 * other path is the file of that name or, failing that, the directory's
 * index.html.
 *
 * Tori then has one more rule, which this leaves out on purpose: a path that
 * names no file is answered with the site's own /index.html, so that a
 * single-page app can draw it. For this site that would turn every broken
 * link into a copy of the first page, served with 200, and no checker that
 * honoured it could find one.
 */
export function fileFor(dist, pathname) {
  let path
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const parts = path.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || part === '.')) return null
  const joined = parts.join('/')
  const isFile = (rel) => existsSync(join(dist, rel)) && statSync(join(dist, rel)).isFile()
  const candidates =
    parts.length === 0 || path.endsWith('/')
      ? [parts.length === 0 ? 'index.html' : `${joined}/index.html`]
      : hasExtension(parts.at(-1))
        ? [joined]
        : [joined, `${joined}/index.html`]
  return candidates.find(isFile) ?? null
}

// As Tori reads it: `.well-known` is a hidden name and `v1.0` a directory,
// neither one a file with an extension.
function hasExtension(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 && /^(?!\d+$).+$/.test(name.slice(dot + 1))
}

/** Every link in every page of `dist` that names no file there, as "page -> link". */
export function brokenLinks(dist, origin) {
  const broken = []
  for (const file of filesUnder(dist).filter((f) => /\.(html|xml)$/.test(f))) {
    const page = new URL(urlOf(file), origin)
    const text = readFileSync(join(dist, file), 'utf8')
    // The feed links by absolute address, in elements rather than attributes.
    const links = file.endsWith('.xml') ? [...text.matchAll(/<link>([^<]*)<\/link>/g)].map(([, link]) => link) : linksIn(text)
    for (const link of links) {
      if (link.startsWith('#')) continue
      const target = new URL(link, page)
      // Another site's page is not ours to check, and not reachable offline.
      if (target.origin !== page.origin) continue
      if (fileFor(dist, target.pathname) === null) broken.push(`${urlOf(file)} -> ${link}`)
    }
  }
  return broken
}

/**
 * What keeps `xml` from being well formed, as far as a feed needs: every
 * element closed in order, one root, and no bare `&` or `<` in text.
 */
export function xmlProblems(xml) {
  const problems = []
  if (!xml.startsWith('<?xml ')) problems.push('no XML declaration')
  const body = xml.replace(/^<\?xml[^>]*\?>/, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const stack = []
  let roots = 0
  for (const [, closing, name, selfClosing] of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (closing) {
      const open = stack.pop()
      if (open !== name) problems.push(`</${name}> closes <${open ?? 'nothing'}>`)
    } else if (!selfClosing) {
      if (stack.length === 0) roots += 1
      stack.push(name)
    } else if (stack.length === 0) roots += 1
  }
  if (stack.length > 0) problems.push(`never closed: <${stack.join('>, <')}>`)
  if (roots !== 1) problems.push(`${roots} root elements`)
  const text = body.replace(/<[^<>]*>/g, '')
  if (text.includes('<')) problems.push('a stray <')
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(text)) problems.push('a bare &')
  return problems
}
