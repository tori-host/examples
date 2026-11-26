# saffron wren

A Next.js app with the App Router and no Dockerfile: recipes, scaled to your
table. Six recipes live in the code; each one has a servings control that
rescales every ingredient as you click, rounded the way a cook would write it,
in metric or US units. It runs at <https://saffron-wren.tori.cloud>, where it is
an example run by [Tori](https://tori.host/).

## Deploy your own

With Node.js installed:

```sh
git clone https://github.com/tori-host/examples
cd examples/saffron-wren
npx tori.host
```

The CLI sees `next` in `package.json`'s `dependencies` and deploys the
directory as a service: Next.js draws pages on a server, so it is not a set of
files to publish (only a Next.js app with `output: 'export'` would be). Tori
builds it from the source, so nothing needs installing first: it runs
`npm run build`, then `npm start`, which is `next start` on the port in `PORT`
(`8080` on Tori). The first run signs you in, creates a service under a new
name of its own and writes that name to `tori.json`; later runs update the same
service.

`npx tori.host deploy build-log` prints the build log of the latest deploy,
and `npx tori.host logs` what the server printed.

## What it shows

- `GET /` lists the recipes and `GET /recipes/<slug>` shows one, both drawn on
  the server for each request. An unknown recipe is a 404.
- The servings control is a client component (`app/recipes/[slug]/scaler.jsx`).
  It rescales in the browser with `lib/scale.js`, the same module the server
  and the API use, so the page and the JSON always agree.
- `GET /api/recipes/<slug>?servings=6&units=us` answers the scaled ingredients
  as JSON. `servings` is a whole number from 1 to 48 and `units` is `metric`
  (the default) or `us`; anything else is a 400, and an unknown recipe a 404.
- Rounding: eggs come whole, an onion or a lemon can be halved, spoons go to a
  quarter teaspoon or half a tablespoon, grams and millilitres to 5 and then to
  kilograms and litres. Nothing a recipe needs is ever rounded away. US units
  are ounces, pounds, cups and quarts; grams are not turned into cups, because
  that would need the density of every ingredient.
- Every response carries a strict Content-Security-Policy with a fresh nonce
  (`proxy.js`), which Next.js puts on each script it writes, and
  `X-Content-Type-Options`, `Referrer-Policy` and `X-Robots-Tag: noindex`
  (`next.config.mjs`). That is why every page is drawn per request
  (`await connection()` in `app/layout.jsx`): a page built ahead of time
  would have no nonce, and its scripts would be blocked.
- When nobody visits for a while the server naps, and the next request wakes
  it. That request takes longer than the ones after it.

## Run it

Node.js 20.9 or newer, as Next.js 16 needs:

```sh
npm install
npm run dev      # http://localhost:8080, with reloading
npm run build && npm start
npm test
```

`npm test` runs the scaling module's tests, then builds the app and starts
the production server on a free port to check what it sends: the headers on
pages, the API, static files and 404s, the nonce on every script, and that it
serves none of its own source. The scripts set `NEXT_TELEMETRY_DISABLED=1`, so
neither a build nor the server reports to Vercel's telemetry.
