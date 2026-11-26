// What every example promises, checked against examples.json and the files:
// `node --test test/examples.test.mjs`. It needs nothing installed.
//
// Each example is drawn on tori.host from examples.json and deployed from it.
// So the list has to match the directories, every page has to say what it is
// and where its source is, and no file may carry anything of Tori's own
// infrastructure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'examples.json'), 'utf8'))

/** What a visitor's own machine adds to a checkout. None of it is published. */
const LOCAL = new Set(['.git', 'node_modules', 'dist', 'tori.json', '.venv', '__pycache__', '.pytest_cache'])

function filesUnder(dir, skip = LOCAL) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(path, skip))
    else out.push(path)
  }
  return out
}

const exampleDirs = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'test' && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort()

test('examples.json lists every example directory, and only those', () => {
  assert.deepEqual(manifest.examples.map((example) => example.name).sort(), exampleDirs)
})

test('the list is well formed', () => {
  assert.equal(manifest.repository, 'https://github.com/tori-host/examples')
  assert.ok(manifest.examples.length >= 5 && manifest.examples.length <= 10, 'five to ten examples')
  for (const example of manifest.examples) {
    const where = example.name
    assert.match(example.name, /^[a-z]+-[a-z]+$/, where)
    assert.equal(example.url, `https://${example.name}.tori.cloud`, where)
    assert.ok(['static', 'service'].includes(example.kind), where)
    if (example.kind === 'service') assert.ok(['dockerfile', 'detected'].includes(example.build), where)
    else assert.equal(example.build, undefined, where)
    assert.ok(example.title && example.stack, where)
    assert.ok(Array.isArray(example.deploy) && example.deploy.length > 0, where)
    assert.ok(example.deploy.some((step) => /^npx tori\.host( |$)/.test(step)), where)
    assert.match(example.check.path, /^\/[a-z/-]*$/, where)
    assert.ok(typeof example.check.contains === 'string' && example.check.contains.length > 0, where)
    // The deploy workflow runs `release` as the release command, and a
    // visitor runs the last deploy step: the two must be the same command.
    if (example.release !== undefined) {
      assert.equal(example.kind, 'service', where)
      assert.equal(example.deploy.at(-1), `npx tori.host deploy --release "${example.release}"`, where)
    } else {
      assert.ok(!example.deploy.some((step) => step.includes('--release')), where)
    }
  }
})

test('an example with its own Dockerfile says so, and one without does not', () => {
  for (const example of manifest.examples) {
    const has = existsSync(join(root, example.name, 'Dockerfile'))
    assert.equal(has, example.build === 'dockerfile', example.name)
  }
})

for (const example of manifest.examples) {
  test(`${example.name}: a README, the live address, and a page that says what it is`, () => {
    const dir = join(root, example.name)
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    // The binding a visitor's first deploy writes is theirs. This file travels
    // with the public copy, where the repository's own .gitignore does not.
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^tori\.json$/m, '.gitignore keeps tori.json out')
    assert.ok(readme.includes(example.url), 'the README names the live address')
    const texts = filesUnder(dir)
      .filter((path) => /\.(html|jsx?|mjs|py)$/.test(path) && statSync(path).size < 200_000)
      .map((path) => readFileSync(path, 'utf8'))
    const anywhere = (needle) => texts.some((text) => text.includes(needle))
    // The marker the scheduled check looks for has to be on the page, or the
    // check is red from its first run and teaches everyone to ignore it.
    // A marker whose value the server fills in (`data-database="ready"`) is
    // in the source as the attribute and an interpolation. Then the value has
    // to be one the same file can produce, written as a string there, or a
    // typo in examples.json would pass here and be red on every probe.
    const [, attribute, value] = /^([a-z-]+)="([^"]*)"$/.exec(example.check.contains) ?? []
    const filled = attribute && texts.find((text) => text.includes(`${attribute}="\${`))
    assert.ok(
      anywhere(example.check.contains) || (filled && filled.includes(`'${value}'`)),
      `the page carries ${example.check.contains}`,
    )
    assert.ok(anywhere('an example run by'), 'the page says it is an example run by Tori')
    // The pages on tori.host are the ones meant to be found, not these copies.
    assert.ok(anywhere('<meta name="robots" content="noindex" />'), 'the page asks not to be indexed')
    assert.ok(anywhere(`${manifest.repository}/tree/main/${example.name}`), 'the page links its source')
  })
}

// The generic shapes are here. The names of Tori's own hosts and accounts are
// not: spelling them in a public file is the leak this test is for. They come
// from the repository secret EXAMPLES_FORBIDDEN, one regular expression per
// line, which a pull request from a fork or from Dependabot does not get
// (the workflow says so and sets EXAMPLES_FORBIDDEN_OPTIONAL).
test('nothing here names Tori-internal hosts, addresses or accounts', (t) => {
  const named = (process.env.EXAMPLES_FORBIDDEN ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((source) => new RegExp(source, 'i'))
  if (named.length === 0) {
    if (process.env.CI && process.env.EXAMPLES_FORBIDDEN_OPTIONAL !== '1') {
      assert.fail('EXAMPLES_FORBIDDEN is empty: without it this test checks only the generic shapes')
    }
    t.diagnostic('EXAMPLES_FORBIDDEN is not set here: checking the generic shapes only')
  }
  const forbidden = [
    ...named,
    /\.int\./,
    /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
    /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  ]
  const offenders = []
  for (const path of filesUnder(root)) {
    if (statSync(path).size > 2_000_000) continue
    const text = readFileSync(path, 'utf8')
    // The offender is named by file and by the pattern's place in the list,
    // never by the pattern: the log of a public repository is public too.
    forbidden.forEach((pattern, i) => {
      if (pattern.test(text)) offenders.push(`${path.slice(root.length)}: pattern ${i + 1}`)
    })
    // The one address an example may print is the public one for questions.
    for (const email of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
      if (email !== 'hello@tori.host' && !/@(sha256|types|vitejs|rolldown|babel|oxc)/.test(email) && !/^[\w-]+@\d/.test(email)) {
        offenders.push(`${path.slice(root.length)}: an email address`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

// The scans above leave tori.json out, because a deploy from a checkout writes
// one and it is the visitor's. One that was committed would be published with
// the rest, and it names the app it deploys to.
test('no app binding is committed', () => {
  // A CI checkout holds only what was committed, and the job's image has no
  // git; on a workstation git tells a committed binding from a local one.
  const committed = process.env.CI
    ? filesUnder(root, new Set(['node_modules'])).filter((path) => basename(path) === 'tori.json')
    : execFileSync('git', ['ls-files', '--', ':(glob)**/tori.json'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.deepEqual(committed, [])
})

// The tests of a Python example install requirements-dev.txt, the build
// requirements.txt. Compiled separately, the two could pin one package at
// two versions, and the tests would pass for a server that is not the one
// that ships.
test('a Python example tests the versions it ships', () => {
  const pins = (path) =>
    new Map([...readFileSync(path, 'utf8').matchAll(/^([A-Za-z0-9._-]+)==([^\s\\]+)/gm)].map(([, name, version]) => [name.toLowerCase(), version]))
  for (const example of manifest.examples) {
    const dir = join(root, example.name)
    if (!existsSync(join(dir, 'requirements-dev.txt'))) continue
    const ships = pins(join(dir, 'requirements.txt'))
    const tested = pins(join(dir, 'requirements-dev.txt'))
    assert.ok(ships.size > 0, `${example.name}: requirements.txt pins nothing`)
    for (const [name, version] of ships) assert.equal(tested.get(name), version, `${example.name}: ${name}`)
  }
})
