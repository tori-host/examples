# misty heron

A placeholder image service: `GET /640x360.svg` answers an SVG 640 by 360
pixels that says `640 × 360`, for a layout that is waiting for its pictures.
An Express server with no Dockerfile. It runs at
<https://misty-heron.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

## Use it

```
GET /<width>x<height>.svg
GET /<width>x<height>.svg?bg=<hex>&fg=<hex>
```

- Width and height are whole numbers from 1 to 4000, without leading zeros.
- `bg` is the background and `fg` the text, each exactly 3 or 6 hex digits,
  without `#`. Both are optional.
- Any other size, colour or parameter is a `400` with a fixed sentence.
- An image never changes, so it is sent with
  `Cache-Control: public, max-age=31536000, immutable`.

The image says its own size and nothing else. There is no parameter for text,
and no part of the address is copied into an image or an error: the text is
built from the two numbers, the colours from two strings that match a strict
pattern. Otherwise anyone could write an address that serves their words, or
their markup, from this domain.

## Deploy your own

With Node.js installed:

```sh
git clone https://github.com/tori-host/examples
cd examples/misty-heron
npx tori.host
```

The CLI sees `express` in `package.json`'s `dependencies` and deploys the
directory as a service. Tori builds it from the source, so nothing needs
installing first, and runs `npm start` with `PORT` set to `8080`. The first
run signs you in, creates a service under a new name of its own and writes
that name to `tori.json`; later runs update the same service.

`npx tori.host deploy build-log` prints the build log of the latest deploy,
and `npx tori.host logs` what the server printed.

When nobody visits for a while the server naps, and the next request wakes
it. That request takes longer than the ones after it; an image a browser or a
cache already holds is not asked for again.

## How it is put together

- `placeholder.js` reads the size and the colours and draws the SVG, with no
  server around it, so its tests need none.
- `server.js` is the Express app: the page at `/`, the images, `/healthz`,
  and the stylesheet and icon from `public/`. Every answer carries a strict
  `Content-Security-Policy`, which covers an SVG opened on its own too,
  `X-Content-Type-Options: nosniff` and `X-Robots-Tag: noindex`.

## Run it

```sh
npm install
npm start        # http://localhost:8080
npm test
```
