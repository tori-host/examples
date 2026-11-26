// The database side: what the server asks Postgres, and nothing else. The
// server is given an object with these methods, so its tests can give it one
// that needs no database.
import pg from 'pg'

/** No option's count goes past this in a day, so a flood of clicks ends at a number that still reads well. */
export const MAX_COUNT = 999_999

/**
 * Today, as the poll counts it: the date in Prague, worked out by Postgres,
 * so every copy of the server agrees on when the day ends, whatever clock or
 * time zone the container has.
 */
const TODAY = "(now() AT TIME ZONE 'Europe/Prague')::date"

/** How long a connection or a query may take before the page gives up on the database. */
export const DEFAULT_TIMEOUT_MS = 5_000

/**
 * How `pg` should read a connection URL.
 *
 * Tori's `DATABASE_URL` ends in `sslmode=require`: encrypt the connection, as
 * libpq (psql, and most drivers) reads that word. pg 8 reads it differently,
 * as `verify-full`, and checks the server's certificate against the public
 * certificate authorities. The managed database's certificate is issued by
 * its own cluster, so that check fails and nothing connects. pg's own answer
 * is `uselibpqcompat=true`, which makes it read `require` as libpq does; it is
 * added here rather than to the URL, because psql refuses a URL with a
 * parameter it does not know. A URL that asks for `verify-full`, or for no
 * TLS at all, is left as it is.
 */
export function connectionConfig(url) {
  const parsed = new URL(url)
  const mode = parsed.searchParams.get('sslmode')
  if (['prefer', 'require', 'verify-ca'].includes(mode) && !parsed.searchParams.has('uselibpqcompat')) {
    parsed.searchParams.set('uselibpqcompat', 'true')
  }
  return { connectionString: parsed.toString() }
}

/**
 * The database the app was given, or none. `DATABASE_URL` is set by Tori once
 * `npx tori.host db create` has made the database and the app was deployed
 * again; until then the app runs and says what is missing.
 */
export function openDatabase(url = process.env.DATABASE_URL, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) return null
  // A small pool: the plan caps the connections a database accepts, and a
  // server that naps opens them again on its next request anyway.
  //
  // Every wait has an end, on both sides. A database that
  // takes a connection and never answers, or a query stuck behind a
  // migration's lock, would otherwise hold all three connections, and every
  // request after them would queue until the proxy gave up.
  //
  // - The database's own deadline, `statement_timeout`, ends the query on the
  //   server, so it stops waiting on the lock too and a write it ends is
  //   rolled back. It is set with SET LOCAL inside each transaction: Tori's
  //   database is reached through PgBouncer in transaction mode, which keeps
  //   a setting for one transaction and refuses one sent at connection start.
  // - pg's deadlines, a little longer, cover a database that does not answer
  //   at all, where the server's own deadline cannot arrive.
  const pool = new pg.Pool({
    ...connectionConfig(url),
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs + 1_000,
  })
  // An idle connection the database closes (a restart, a failover) is an
  // `error` on the pool. Unhandled, it would stop the process.
  pool.on('error', (error) => console.error('database connection lost:', error.message))

  /** Run `work(client)` in one transaction under the database's deadline. */
  const transaction = async (work) => {
    const client = await pool.connect()
    let failure
    try {
      await client.query('BEGIN')
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`)
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      failure = error
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      // A connection that failed is dropped rather than handed to the next request.
      client.release(failure)
    }
  }

  return {
    /** `ready`, or `unmigrated` when the release command has not created the table yet. */
    state: () =>
      transaction(async (client) => {
        const { rows } = await client.query("SELECT to_regclass('public.votes') IS NOT NULL AS ready")
        return rows[0].ready ? 'ready' : 'unmigrated'
      }),
    /** Today's votes: option id → count, for every option that has one. */
    counts: () =>
      transaction(async (client) => {
        const { rows } = await client.query(`SELECT option_id, count FROM votes WHERE day = ${TODAY}`)
        return new Map(rows.map((row) => [row.option_id, Number(row.count)]))
      }),
    /** One more vote for an option today. Returns its new count. */
    vote: (optionId) =>
      transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO votes (day, option_id, count) VALUES (${TODAY}, $1, 1)
           ON CONFLICT (day, option_id) DO UPDATE SET count = LEAST(votes.count + 1, $2), last_vote = now()
           RETURNING count`,
          [optionId, MAX_COUNT],
        )
        return Number(rows[0].count)
      }),
    close: () => pool.end(),
  }
}
