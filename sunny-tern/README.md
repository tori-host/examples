# sunny tern

A single-page app: Vite and React, with two pages and no router library. A
tally of birds seen on a walk, kept in the browser's `localStorage`. It runs at
<https://sunny-tern.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

## Deploy your own

With Node.js 20.19 or a later 20.x, or 22.12 or newer (what Vite needs), from this directory:

```sh
npm install
npx tori.host
```

With no `dist/` yet, the CLI runs `npm run build` and publishes `dist/` as a
static site. The first run signs you in, creates a site under a new name of
its own and writes that name to `tori.json`; later runs update the same site.

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

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # the tally's tests
```
