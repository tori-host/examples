// What "an example is up" means, for the deploy and for the scheduled probe:
// its check path answers 200 and the page carries its marker
// (examples.json). One answer is not enough to say either way: right after a
// deploy an address can answer 404 for a few seconds, so this asks again
// until the deadline.
import { readFileSync } from 'node:fs'

export const manifest = JSON.parse(readFileSync(new URL('../../examples.json', import.meta.url), 'utf8'))

export function example(name) {
  const found = manifest.examples.find((entry) => entry.name === name)
  if (!found) throw new Error(`${name} is not in examples.json`)
  return found
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function check({ url, check: { path, contains } }, { deadlineMs = 90_000, everyMs = 5_000 } = {}) {
  const deadline = Date.now() + deadlineMs
  let last = 'no answer'
  for (;;) {
    try {
      const res = await fetch(url + path, {
        redirect: 'manual',
        headers: { 'cache-control': 'no-cache', 'user-agent': 'tori-examples-check' },
        signal: AbortSignal.timeout(15_000),
      })
      const body = await res.text()
      if (res.status === 200 && body.includes(contains)) return { ok: true, last: `200 with ${contains}` }
      last = res.status === 200 ? `200 without ${contains}` : `${res.status}`
    } catch (error) {
      last = error.cause?.code ?? error.name ?? String(error)
    }
    if (Date.now() + everyMs > deadline) return { ok: false, last }
    await sleep(everyMs)
  }
}
