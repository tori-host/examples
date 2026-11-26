// Which examples to deploy, and from which verified deploy to recover.
//
// An example is behind when its directory or its examples.json entry changed
// since deployed/<name>, the last commit that went live and passed its check
// (an annotated tag whose subject is "deploy <id>"). It is held, not
// deployed, when the same content already failed: failed/<name> marks that
// commit, and trying it again every half hour would put a broken version
// live every half hour. Any change to the example lifts the hold.
//
// Nothing at all when this run's commit is no longer the head of main: a
// re-run of an old run would otherwise put an old version back.
//
// Prints `examples=<JSON>`, `build=<JSON>` and `held=<JSON>` for $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { manifest } from './live.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const has = (ref) => {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)
    return true
  } catch {
    return false
  }
}
const entryAt = (ref, name) => JSON.stringify(JSON.parse(git('show', `${ref}:examples.json`)).examples.find((entry) => entry.name === name) ?? null)
const differs = (ref, example) => git('diff', '--name-only', ref, 'HEAD', '--', example.name) !== '' || entryAt(ref, example.name) !== JSON.stringify(example)

const out = (examples, build, held) => {
  console.log(`examples=${JSON.stringify(examples)}`)
  console.log(`build=${JSON.stringify(build)}`)
  console.log(`held=${JSON.stringify(held)}`)
}

const head = git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0]
const self = git('rev-parse', 'HEAD')
if (head !== self) {
  console.error(`main is at ${head}, this run is at ${self}: deploying nothing, the run for main does that`)
  out([], [], [])
  process.exit(0)
}

const examples = []
const held = []
for (const example of manifest.examples) {
  const deployed = `refs/tags/deployed/${example.name}`
  const failed = `refs/tags/failed/${example.name}`
  const verified = has(deployed) ? (/^deploy (d_[0-9a-z]+)$/.exec(git('for-each-ref', '--format=%(contents:subject)', deployed)) ?? [])[1] ?? '' : ''
  let why = null
  if (!has(deployed)) why = 'never deployed from here'
  else if (differs(deployed, example)) why = `changed since ${deployed.slice(10)}`
  else if (process.env.ALL === 'true') why = 'redeploy of every example'
  if (why && has(failed) && !differs(failed, example) && process.env.RETRY_HELD !== 'true') {
    console.error(`${example.name}: held, this content already failed (${failed.slice(10)} at ${git('rev-parse', '--short', failed)})`)
    held.push(example.name)
    continue
  }
  console.error(`${example.name}: ${why ?? 'up to date'}${verified ? ` (verified: ${verified})` : ''}`)
  if (why) examples.push({ name: example.name, verified })
}
// A static site with a build is built in a job without secrets; the deploy
// job only publishes what it built.
const build = examples
  .filter(({ name }) => manifest.examples.find((entry) => entry.name === name).kind === 'static' && existsSync(`${name}/package-lock.json`))
  .map(({ name }) => name)
out(examples, build, held)
