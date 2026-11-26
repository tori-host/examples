// Every example, live, at once. Red when any of them is not up.
import { check, manifest } from './live.mjs'

const results = await Promise.all(manifest.examples.map(async (example) => ({ example, ...(await check(example, { deadlineMs: 60_000 })) })))
for (const { example, ok, last } of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${example.url}${example.check.path}: ${last}`)
process.exit(results.every((result) => result.ok) ? 0 : 1)
