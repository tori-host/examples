// Deploy one example the way its README does, check it live, and put the
// previous version back when the new one does not pass.
//
//   TORI_TOKEN=torid_... node .github/scripts/deploy.mjs <name>
//
// The token is a deploy token for that one app: it can deploy it, read its
// deploys and roll it back, and nothing else.
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { check, example as find } from './live.mjs'

const API = process.env.TORI_API_URL ?? 'https://api.tori.host'
const name = process.argv[2]
const example = find(name)
const token = process.env.TORI_TOKEN
if (!token) {
  console.error(`TORI_TOKEN is empty: the environment has no deploy token for ${name}`)
  process.exit(1)
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

const live = async () => (await api('GET', `/api/apps/${name}/deploys`)).find((deploy) => deploy.status === 'live')?.id ?? null

const run = (command, args) => spawnSync(command, args, { cwd: name, stdio: 'inherit' }).status === 0

// The CLI's own output, shown as it comes and kept to read the refusal.
function deploy(args) {
  const res = spawnSync('npx', ['-y', 'tori.host@latest', 'deploy', ...args], { cwd: name, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.stdout.write(res.stdout ?? '')
  process.stderr.write(res.stderr ?? '')
  return { ok: res.status === 0, output: `${res.stdout}${res.stderr}` }
}

// Refusals that say "not now" rather than "not this": the account has too
// many deploys going, or asked too fast. Anything else is not retried.
const BUSY = /rate_limited|too many deploys in flight/

async function deployWithRetries(args) {
  for (const waitS of [30, 60, 120, null]) {
    const attempt = deploy(args)
    if (attempt.ok || !BUSY.test(attempt.output) || waitS === null) return attempt.ok
    console.log(`${name}: Tori is busy with this account's deploys; again in ${waitS}s`)
    await new Promise((resolve) => setTimeout(resolve, waitS * 1000))
  }
}

const before = await live()
console.log(`${name}: ${before ?? 'nothing'} is live`)

// The binding a first deploy from a checkout writes. It is not committed:
// a visitor's first deploy makes an app of their own.
writeFileSync(`${name}/tori.json`, `${JSON.stringify({ slug: name })}\n`)
// A static site is built here, by the CLI's `npm run build`; a service is
// built on Tori from the source, so nothing is installed for it.
const installed = example.kind !== 'static' || !existsSync(`${name}/package-lock.json`) || run('npm', ['ci', '--ignore-scripts', '--no-fund', '--no-audit'])
const deployed = installed && (await deployWithRetries(example.release ? ['--release', example.release] : []))
const after = await live()
const result = await check(example)
console.log(`${name}: deploy ${deployed ? 'finished' : 'failed'}, ${after ?? 'nothing'} is live, check: ${result.last}`)
if (deployed && result.ok && after !== null) process.exit(0)

// A service whose release command or rollout failed is still serving the
// previous version; a deploy that went live and fails its check is not.
if (before && after && after !== before) {
  console.error(`${name}: putting ${before} back`)
  await api('POST', `/api/apps/${name}/rollback`, { deployId: before })
  const again = await check(example)
  console.error(`${name}: after the rollback, check: ${again.last}`)
}
process.exit(1)
