// The release command: apply every migration in ./migrations that has not run
// yet, in file-name order, in one transaction. Tori runs it
// before a new revision takes traffic (`--release "node migrate.mjs"`); if it
// fails, the revision that was live keeps serving.
//
// Two releases never run their migrations at the same time: each holds a
// transaction-scoped advisory lock while it works, which also holds through
// PgBouncer in transaction mode, the way Tori's managed database is reached.
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionConfig } from './db.mjs'

const MIGRATIONS = new URL('./migrations/', import.meta.url)
/** Any fixed number; it names this app's lock among all advisory locks in the database. */
const LOCK = 7_310_644

/** The migrations on disk, in the order they apply. */
export function migrationFiles(dir = MIGRATIONS) {
  return readdirSync(dir)
    .filter((name) => /^\d{3}-[a-z0-9-]+\.sql$/.test(name))
    .sort()
}

/**
 * Apply what has not been applied, all in one transaction: either every
 * pending migration is applied and recorded, or none is. Returns the names it
 * applied, in order. `client` is a connected `pg.Client`; nothing here closes
 * it.
 */
export async function migrate(client, dir = MIGRATIONS) {
  const applied = []
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK])
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    // Read under the lock: another release may have applied some while this one waited.
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name))
    for (const name of migrationFiles(dir)) {
      if (done.has(name)) continue
      try {
        await client.query(readFileSync(new URL(name, dir), 'utf8'))
      } catch (error) {
        throw new Error(`migration ${name} failed: ${error.message}`, { cause: error })
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
      applied.push(name)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
  return applied
}

const startedAsProgram = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (startedAsProgram) {
  if (!process.env.DATABASE_URL) {
    // Exit non-zero: a release that "succeeds" without a database would let a
    // revision that needs one go live.
    console.error('DATABASE_URL is not set. Create the database first: npx tori.host db create')
    process.exit(1)
  }
  const client = new pg.Client(connectionConfig(process.env.DATABASE_URL))
  try {
    await client.connect()
    const applied = await migrate(client)
    console.log(applied.length === 0 ? 'nothing to migrate' : `applied ${applied.join(', ')}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}
