# misty heron

An Express server with no Dockerfile: one page and one JSON endpoint, both
naming the bird of the day. It runs at <https://misty-heron.tori.cloud>, where
it is an example run by [Tori](https://tori.host/).

## Deploy your own

With Node.js installed, from this directory:

```sh
npx tori.host
```

The CLI sees `express` in `package.json`'s `dependencies` and deploys the
directory as a service. Tori builds it from the source, so nothing needs
installing first, and runs `npm start` with `PORT` set to `8080`. The first
run signs you in, creates a service under a new name of its own and writes
that name to `tori.json`; later runs update the same service.

`npx tori.host deploy build-log` prints the build log of the latest deploy,
and `npx tori.host logs` what the server printed.

## What it shows

- `GET /` is drawn on every request; `GET /api/bird-of-the-day` is the same
  answer as JSON.
- The bird depends on the UTC date only, so every copy of the server gives the
  same answer, after a restart too.
- When nobody visits for a while the server naps, and the next request wakes
  it. That request takes longer than the ones after it.

## Run it

```sh
npm install
npm start        # http://localhost:8080
npm test
```
