// Deploy one example the way its README does, check it live, and put the
// last verified version back when the new one does not pass.
//
//   TORI_TOKEN=torid_... VERIFIED=d_... node .github/scripts/deploy.mjs <name>
//
// The token is a deploy token for that one app: it can deploy it, read its
// deploys and roll it back, and nothing else. Nothing from the example's
// dependencies runs here: a static site with a build arrives built (its
// dist/ comes from a job without secrets), and a service is built on Tori.
// What runs is node, this script and the pinned CLI in .github/ci/cli.
//
// Writes result.json: { name, ok, deploy, restored } for the job that
// records it.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, example as find } from './live.mjs'

const API = process.env.TORI_API_URL ?? 'https://api.tori.host'
const CLI = join(process.cwd(), '.github/ci/cli/node_modules/.bin/tori')
const name = process.argv[2]
const example = find(name)
const sha = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const token = process.env.TORI_TOKEN
const verified = process.env.VERIFIED || null

const result = { name, sha, ok: false, deploy: null, restored: null }
const finish = (code) => {
  writeFileSync('result.json', `${JSON.stringify(result)}\n`)
  process.exit(code)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!token) {
  console.error(`TORI_TOKEN is empty: the environment has no deploy token for ${name}`)
  finish(1)
}

// "Re-run failed jobs" on an old run starts here without the plan: an old
// commit must not replace main's.
const head = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0]
if (head !== sha) {
  console.log(`${name}: main is at ${head}, this run is at ${sha}; not deploying an old commit`)
  result.skipped = true
  finish(0)
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const deploys = () => api('GET', `/api/apps/${name}/deploys`)
const live = async () => (await deploys()).find((deploy) => deploy.status === 'live')?.id ?? null

/** Until no deploy of the app is still building: a CLI that gave up may have left one that goes live later. */
async function settled() {
  for (let i = 0; i < 40; i += 1) {
    if (!(await deploys()).some((deploy) => deploy.status === 'building')) return
    await sleep(15_000)
  }
  console.error(`${name}: a deploy is still building after 10 minutes`)
}

// The CLI's own output, shown as it comes and kept to read the refusal.
function deploy(args) {
  const res = spawnSync(CLI, ['deploy', ...args], { cwd: name, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write(res.stdout ?? '')
  process.stderr.write(res.stderr ?? '')
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}${res.error ?? ''}` }
}

// Refusals that say "not now" rather than "not this": the account has too
// many deploys going, or asked too fast. Anything else is not retried.
const BUSY = /rate_limited|too many deploys in flight/

async function deployWithRetries(args) {
  for (const waitS of [30, 60, 120, null]) {
    const attempt = deploy(args)
    if (attempt.ok || !BUSY.test(attempt.output) || waitS === null) return attempt.ok
    console.log(`${name}: Tori is busy with this account's deploys; again in ${waitS}s`)
    await sleep(waitS * 1000)
  }
}

// What a deploy is judged by: the address after it has settled, never the
// first answer, which may still come from the version before.
const AFTER_DEPLOY = { settleMs: 30_000, passes: 3, deadlineMs: 120_000 }

const before = await live()
console.log(`${name}: ${before ?? 'nothing'} is live, ${verified ?? 'none'} is the last verified deploy`)

// The binding a first deploy from a checkout writes. It is not committed:
// a visitor's first deploy makes an app of their own.
writeFileSync(join(name, 'tori.json'), `${JSON.stringify({ slug: name })}\n`)

// A static site also says which commit it is, and the check asks for that:
// its marker is the same in every version, so the marker alone would pass
// on the version before for as long as the address kept serving it.
let published = null
if (example.kind === 'static') {
  const built = join(name, 'dist')
  if (existsSync(join(name, 'package.json')) && !existsSync(join(built, 'index.html'))) {
    console.error(`${name}: no dist/ from the build job; not building here, next to the token`)
    finish(1)
  }
  published = existsSync(join(built, 'index.html')) ? built : name
  writeFileSync(join(published, 'deployed-commit.txt'), `${sha}\n`)
}

const deployed = await deployWithRetries(example.release ? ['--release', example.release] : [])
if (!deployed) await settled()
const after = await live()
result.deploy = after

const marker = await check(example, AFTER_DEPLOY)
const commit = published
  ? await check({ url: example.url, check: { path: '/deployed-commit.txt', contains: sha } }, { ...AFTER_DEPLOY, settleMs: 0 })
  : { ok: true, last: 'not a static site' }
console.log(`${name}: deploy ${deployed ? 'finished' : 'failed'}, ${after ?? 'nothing'} is live; marker: ${marker.last}; commit: ${commit.last}`)
if (deployed && marker.ok && commit.ok && after !== null) {
  result.ok = true
  finish(0)
}

// A service whose release command or rollout failed is still serving what
// was live; a deploy that went live and fails its check is not. Back to the
// last deploy that passed, or, before the first one, to what was live.
const target = verified ?? before
if (after && target && after !== target) {
  console.error(`${name}: putting ${target} back`)
  try {
    await api('POST', `/api/apps/${name}/rollback`, { deployId: target })
    const again = await check(example, AFTER_DEPLOY)
    result.restored = { deploy: target, ok: again.ok }
    console.error(`${name}: after the rollback, marker: ${again.last}`)
  } catch (error) {
    result.restored = { deploy: target, ok: false }
    console.error(`${name}: the rollback failed: ${error.message}`)
  }
}
finish(1)
