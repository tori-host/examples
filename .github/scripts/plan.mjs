// Which examples to deploy: those whose directory or examples.json entry
// changed since the commit the tag deployed/<name> points at, the last one
// that went live and passed its check. All of them when ALL is "true".
// Prints `examples=<JSON>` for $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process'
import { manifest } from './live.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

function stale(example) {
  if (process.env.ALL === 'true') return 'redeploy of every example'
  const tag = `deployed/${example.name}`
  try {
    git('rev-parse', '--verify', `refs/tags/${tag}`)
  } catch {
    return 'never deployed from here'
  }
  if (git('diff', '--name-only', tag, 'HEAD', '--', example.name).trim()) return `changed since ${tag}`
  const then = JSON.parse(git('show', `${tag}:examples.json`)).examples.find((entry) => entry.name === example.name)
  if (JSON.stringify(then) !== JSON.stringify(example)) return `its entry changed since ${tag}`
  return null
}

const chosen = []
for (const example of manifest.examples) {
  const why = stale(example)
  console.error(`${example.name}: ${why ?? 'up to date'}`)
  if (why) chosen.push({ name: example.name, secret: `TORI_TOKEN_${example.name.toUpperCase().replace(/-/g, '_')}` })
}
console.log(`examples=${JSON.stringify(chosen)}`)
