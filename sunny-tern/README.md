# sunny tern

Split the bill: add the people who were there and what each of them paid,
split equally among whoever shared it, and the page works out who pays whom,
in the fewest transfers. A single-page app in Vite and React, with two pages
and no router library. The bill is kept in the browser's `localStorage` and
nothing is sent anywhere. It runs at <https://sunny-tern.tori.cloud>, where
it is an example run by [Tori](https://tori.host/).

## Deploy your own

With Node.js 20.19 or a later 20.x, or 22.12 or newer (what Vite needs):

```sh
git clone https://github.com/tori-host/examples
cd examples/sunny-tern
npm install
npx tori.host
```

Nothing here looks like a server to the CLI (React is a library, and Vite a
development dependency), so it is a static site. The CLI looks for an
`index.html` in `dist/`; with no `dist/` yet, it runs `npm run build` on your
machine, looks again and publishes `dist/`. Tori serves those files; nothing
runs for the site, so it never naps. The first run signs you in, creates a
site under a new name of its own and writes that name to `tori.json`; later
runs update the same site.

Once `dist/` exists, the CLI publishes it as it is, so build again before each
deploy:

```sh
npm run build && npx tori.host
```

## How a single-page app is served

Tori answers a path that names no file, such as `/about`, with `index.html`,
and the app's script draws the page the path asks for. So a link to any page of
the app works when it is opened directly or reloaded. A path that names a file
that does not exist, such as `/missing.png`, is a 404.

## How it is put together

- `src/settle.js` is the arithmetic, with no React and no storage. Money is
  whole cents, never a float: an amount is read into cents, an expense is
  split into shares of whole cents that add up to it exactly (the cents that
  do not divide go one each to the first people), so the balances always sum
  to zero. The fewest transfers come from the largest number of groups whose
  balances sum to zero, found by trying every subset; the usual shortcut,
  largest debt to largest creditor, can take one transfer more.
- `src/bill.js` is the bill: adding and removing people and expenses, with
  bounds on names, amounts and counts, and keeping it in `localStorage`. What
  it reads back is checked, not trusted, and a browser that refuses to keep it
  is told apart from one that does.
- `src/App.jsx` draws the pages. A change starts from what the browser holds
  now, so two tabs do not undo each other, and a change made in another tab
  shows up here.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # the arithmetic's and the bill's tests
```
