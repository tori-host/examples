// After the deploys: what went live and passed moves deployed/<name>, an
// annotated tag whose subject is "deploy <id>", the deploy to come back to.
// What did not marks failed/<name>, so the next runs hold it instead of
// putting it live again every half hour, and says so in an issue, once.
//
//   PLANNED=<plan's examples JSON> GH_TOKEN=... node .github/scripts/record.mjs
// reads results/result-<name>/result.json, written by deploy.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const sha = process.env.GITHUB_SHA
const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
const git = (...args) => execFileSync('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', ...args], { stdio: 'inherit' })
const issue = (title, body) => execFileSync('.github/scripts/issue.sh', [title, body], { stdio: 'inherit' })

let failures = 0
for (const { name } of JSON.parse(process.env.PLANNED ?? '[]')) {
  const path = `results/result-${name}/result.json`
  const result = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  const title = `Deploy of ${name} failed`
  if (result?.skipped) {
    console.log(`${name}: not deployed, main moved on`)
  } else if (result?.ok && result.sha === sha) {
    git('tag', '-f', '-a', `deployed/${name}`, '-m', `deploy ${result.deploy}`, sha)
    git('push', '-f', 'origin', `refs/tags/deployed/${name}`)
    try {
      execFileSync('git', ['push', 'origin', `:refs/tags/failed/${name}`], { stdio: 'ignore' })
    } catch {}
    // The issue a failure opened is answered by this deploy.
    const open = execFileSync('gh', ['issue', 'list', '--repo', process.env.GITHUB_REPOSITORY, '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number,title', '--jq', `map(select(.title == "${title}")) | .[].number`], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    for (const number of open) {
      execFileSync('gh', ['issue', 'close', number, '--repo', process.env.GITHUB_REPOSITORY, '--comment', `Deployed and verified at ${sha} (${result.deploy}), run ${run}.`], { stdio: 'inherit' })
    }
    console.log(`${name}: ${result.deploy} live and verified at ${sha}`)
  } else {
    failures += 1
    git('tag', '-f', `failed/${name}`, sha)
    git('push', '-f', 'origin', `refs/tags/failed/${name}`)
    const what = !result
      ? 'It did not deploy: the tests or the build failed, or the deploy job did not finish.'
      : result.restored
        ? `${result.deploy ?? 'A deploy'} went live and failed its check; ${result.restored.deploy} was put back${result.restored.ok ? ' and passes its check' : ' and does NOT pass its check either'}.`
        : `The deploy failed; ${result.deploy ?? 'nothing'} is live.`
    issue(title, `${what}\n\nCommit ${sha}, run ${run}.\n\nThe example is held at this content: the deploy workflow will not try it again until its directory or its examples.json entry changes, or a run is started by hand with "Redeploy every example".`)
    console.log(`${name}: failed, held at ${sha}`)
  }
}
process.exit(failures ? 1 : 0)
