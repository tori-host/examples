// The queries and the migration against a real Postgres. Set TEST_DATABASE_URL
// to a database these tests may drop tables in, for example:
//
//   docker run --rm -d -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=test postgres:18 \
//     -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem \
//     -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
//   TEST_DATABASE_URL='postgres://postgres:test@127.0.0.1:5432/postgres?sslmode=require' npm test
//
// With TLS on and `sslmode=require`, the way Tori hands an app its database:
// a certificate no public authority issued, which is what pg refuses unless it
// is told to read `require` as libpq does (db.mjs, connectionConfig).
//
// Without it they are skipped, and say so; under CI they fail instead, so that
// a pipeline that forgot the database does not pass by testing nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { parse } from 'pg-connection-string'
import { MAX_COUNT, connectionConfig, openDatabase } from './db.mjs'
import { migrate, migrationFiles } from './migrate.mjs'

const url = process.env.TEST_DATABASE_URL
const skip = url ? false : 'TEST_DATABASE_URL is not set'
if (!url && process.env.CI) {
  test('TEST_DATABASE_URL is set under CI', () => assert.fail('the database tests need TEST_DATABASE_URL'))
}

const connect = async () => {
  const client = new pg.Client(connectionConfig(url))
  await client.connect()
  return client
}

async function freshClient() {
  const client = new pg.Client(connectionConfig(url))
  await client.connect()
  await client.query('DROP TABLE IF EXISTS sightings, schema_migrations')
  return client
}

test('sslmode=require is read as libpq reads it, and nothing else is changed', () => {
  const ssl = (u) => parse(connectionConfig(u).connectionString).ssl
  assert.deepEqual(ssl('postgres://u:p%40ss@db:5432/app?sslmode=require'), { rejectUnauthorized: false })
  assert.equal(parse(connectionConfig('postgres://u:p%40ss@db:5432/app?sslmode=require').connectionString).password, 'p@ss')
  assert.equal(connectionConfig('postgres://u:p@db:5432/app?sslmode=verify-full').connectionString, 'postgres://u:p@db:5432/app?sslmode=verify-full')
  assert.equal(connectionConfig('postgres://u:p@db:5432/app').connectionString, 'postgres://u:p@db:5432/app')
})

// The reason for connectionConfig, against the server these tests are given.
// Only where that server presents a certificate pg cannot verify, as Tori's does.
test('pg on its own refuses a TLS database with its own certificate', { skip: skip || (new URL(url).searchParams.get('sslmode') !== 'require' && 'TEST_DATABASE_URL does not ask for TLS') }, async () => {
  const plain = new pg.Client({ connectionString: url })
  await assert.rejects(plain.connect(), /certificate/)
  await plain.end().catch(() => {})
  const client = await connect()
  const { rows } = await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
  assert.equal(rows[0].ssl, true)
  await client.end()
})

test('the migration creates the table once, and a second run applies nothing', { skip }, async () => {
  const client = await freshClient()
  try {
    assert.deepEqual(await migrate(client), migrationFiles())
    assert.deepEqual(await migrate(client), [])
    const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name')
    assert.deepEqual(rows.map((row) => row.name), migrationFiles())
  } finally {
    await client.end()
  }
})

test('a migration that fails leaves nothing behind', { skip }, async () => {
  const client = await freshClient()
  const dir = mkdtempSync(join(tmpdir(), 'mossy-starling-'))
  writeFileSync(join(dir, '001-good.sql'), 'CREATE TABLE sightings (bird_id text PRIMARY KEY, count bigint NOT NULL)')
  writeFileSync(join(dir, '002-bad.sql'), 'ALTER TABLE no_such_table ADD COLUMN x int')
  try {
    await assert.rejects(migrate(client, pathToFileURL(`${dir}/`)), /migration 002-bad\.sql failed/)
    const { rows } = await client.query("SELECT to_regclass('public.sightings') IS NULL AS gone, to_regclass('public.schema_migrations') IS NULL AS untracked")
    assert.deepEqual(rows[0], { gone: true, untracked: true })
  } finally {
    await client.end()
  }
})

test('two releases at once apply each migration once', { skip }, async () => {
  const setup = await freshClient()
  await setup.end()
  const clients = await Promise.all([0, 1].map(connect))
  try {
    const results = await Promise.all(clients.map((client) => migrate(client)))
    assert.deepEqual(results.flat().sort(), migrationFiles())
  } finally {
    await Promise.all(clients.map((client) => client.end()))
  }
})

test('the server reads states and counts through the same queries it runs live', { skip }, async () => {
  const client = await freshClient()
  const db = openDatabase(url)
  try {
    assert.equal(await db.state(), 'unmigrated')
    await migrate(client)
    assert.equal(await db.state(), 'ready')
    assert.equal((await db.counts()).size, 0)
    assert.equal(await db.record('great-tit'), 1)
    assert.equal(await db.record('great-tit'), 2)
    const counts = await db.counts()
    assert.equal(counts.get('great-tit').count, 2)
    assert.match(counts.get('great-tit').firstSeen, /^\d{4}-\d{2}-\d{2}T/)
    await client.query('UPDATE sightings SET count = $1', [MAX_COUNT])
    assert.equal(await db.record('great-tit'), MAX_COUNT)
  } finally {
    await db.close()
    await client.end()
  }
})

// `timeout` on the test: without the deadline this would wait forever, not fail.
test('a database that accepts and never answers fails within the deadline', { timeout: 10_000 }, async () => {
  // Not a database: it takes the connection and says nothing, ever.
  // Each connection is read and dropped, never answered, and destroyed at the
  // end: a socket left holding pg's unread startup packet would keep this
  // process, and the job running it, alive after the test passed.
  const sockets = new Set()
  const silent = createServer((socket) => {
    sockets.add(socket)
    socket.resume()
    socket.on('error', () => {})
  })
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve))
  const db = openDatabase(`postgres://u:p@127.0.0.1:${silent.address().port}/app`, { timeoutMs: 300 })
  const started = Date.now()
  try {
    await assert.rejects(db.state())
    assert.ok(Date.now() - started < 3_000, `gave up after ${Date.now() - started} ms`)
  } finally {
    await db.close().catch(() => {})
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => silent.close(resolve))
  }
})

test('a query stuck behind a lock fails within the deadline, and the next one runs', { skip, timeout: 10_000 }, async () => {
  const client = await freshClient()
  await migrate(client)
  const db = openDatabase(url, { timeoutMs: 500 })
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE sightings IN ACCESS EXCLUSIVE MODE')
    const started = Date.now()
    await assert.rejects(db.counts())
    assert.ok(Date.now() - started < 3_000, `gave up after ${Date.now() - started} ms`)
    // While the lock is still held: the database ended the waiting query
    // itself, so nothing of it is left queued behind the lock. A deadline
    // kept only by pg would leave it there.
    const { rows } = await client.query(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'",
    )
    assert.equal(rows[0].waiting, 0)
    await client.query('ROLLBACK')
    assert.equal((await db.counts()).size, 0)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await db.close()
    await client.end()
  }
})
