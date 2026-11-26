# mossy starling

A Node.js server that keeps its data in Tori's managed Postgres: everyone who
visits can count birds seen from a window, and the counts are still there
after the server naps, restarts or is deployed again. It runs at
<https://mossy-starling.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

It is the other half of [crimson finch](../crimson-finch), whose counts live in
memory and start over after every nap.

## Deploy your own

With Node.js installed, from this directory:

```sh
npx tori.host
npx tori.host db create
npx tori.host db status        # again, until it says ready
npx tori.host env list         # again, until DATABASE_URL is listed
npx tori.host deploy --release "node migrate.mjs"
```

1. The first deploy creates the service. It has no database yet, so the page
   says so and tells you these steps; nothing is broken.
2. `db create` asks for the database. It is ready a little later; `db status`
   says when. A moment after that Tori attaches its address to the app as
   `DATABASE_URL`, and `npx tori.host env list` shows the key (never the
   value). Deploy only once the key is there: without it the release command
   stops with `DATABASE_URL is not set`, and the deploy does not go live.
3. The last deploy gives the server the new `DATABASE_URL`, and runs
   `node migrate.mjs` before it takes traffic, which creates the table. If it
   fails, the deploy that was live keeps serving.

The flag applies to the deploy it is given to. So that every later deploy runs
the migrations without it, add the command to `tori.json`, next to the name
the first deploy wrote there:

```json
{ "slug": "your-app-name", "release": ["node", "migrate.mjs"] }
```

The database counts toward what your plan allows; `npx tori.host db delete`
removes it with its data, and nothing undoes that.

## How it is put together

- `server.mjs` is the whole server, on `node:http`. The buttons are plain
  HTML forms, so no script is sent to the browser.
- `db.mjs` holds the queries. The server reads `DATABASE_URL` and nothing
  else; there is no connection string in the code.
- Tori's `DATABASE_URL` ends in `sslmode=require`, which pg 8 reads more
  strictly than other clients do: it then checks the database's certificate
  against the public certificate authorities, and the managed database's
  certificate is issued by its own cluster. `connectionConfig` in `db.mjs`
  adds `uselibpqcompat=true`, pg's own switch for reading `require` the way
  psql does: encrypted, without that check. Without it pg does not connect.
- `migrate.mjs` applies `migrations/*.sql` that have not run yet, in one
  transaction, and records them in `schema_migrations`. Two releases at once
  wait for each other on an advisory lock.
- Writes are capped per minute for the whole process, and a form posted from
  another site is refused.

## Run it

```sh
npm install
docker run --rm -d --name mossy-pg -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=test postgres:18 \
  -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
export DATABASE_URL='postgres://postgres:test@127.0.0.1:5432/postgres?sslmode=require'
npm run migrate
npm start                      # http://localhost:8080
TEST_DATABASE_URL=$DATABASE_URL npm test
```

`npm test` drops and creates the example's tables in the database it is
given, so point `TEST_DATABASE_URL` at a throwaway one. Without it the database
tests are skipped.
