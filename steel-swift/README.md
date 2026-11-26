# steel swift

A Go service with no Dockerfile: a status page for the other examples in
this repository. It runs at <https://steel-swift.tori.cloud>, where it is an
example run by [Tori](https://tori.host/).

## Deploy your own

The CLI runs on Node.js; the build runs on Tori, so Go is not needed on your
machine:

```sh
git clone https://github.com/tori-host/examples
cd examples/steel-swift
npx tori.host
```

The CLI sees `go.mod` beside Go code and deploys the directory as a service.
Tori builds the binary from the source, with the Go version on the `go` line
of `go.mod`, and runs it with `PORT` set to `8080`. The first run signs you
in, creates a service under a new name of its own and writes that name to
`tori.json`; later runs update the same service.

It uses the standard library only (`net/http`, `html/template`, `embed`), so
there is no `go.sum`: the build downloads nothing but Go itself. The page
template and the static files are compiled into the binary with `embed`, and
nothing else is, so the server has no source files to serve by mistake.

`npx tori.host deploy build-log` prints the build log of the latest deploy,
and `npx tori.host logs` what the server printed: one line per round of
checks.

## What it shows

- `GET /` lists the examples, each up or down, with its latest latency, its
  share of rounds up and a small latency sparkline (inline SVG, no scripts).
  `GET /api/status` is the same as JSON, history included.
- The list of examples is compiled in, in `examples.go`, with the path and
  marker each one's entry in `examples.json` gives the repository's own live
  check. The server never fetches an address a visitor supplies.
- A check is one `GET` with a 5 s limit, reading at most 1 MiB, that looks for
  the marker. A redirect counts as down and is not followed; neither is it by
  the repository's live check.
- There is no timer. A request runs one round of checks, all at once, when the
  last results are 60 s old or more, and otherwise answers from them. Requests
  that arrive while a round runs wait for that round. So the examples are
  checked at most once a minute however busy the page is, and not at all while
  nobody looks, which lets the service nap.
- The history (the last 30 rounds) is kept in memory. A restart, a new deploy
  and a nap all start it again; the page says so.

## Run it

Go 1.27 or newer:

```sh
go run .          # http://localhost:8080
go test ./...
go vet ./...
```

Without Go, the same in a container:

```sh
docker run --rm -v "$PWD":/src -w /src golang:1.27-alpine go test ./...
```

In a checkout of the whole repository the tests also compare `examples.go`
with `../examples.json`; on its own this directory skips that test.
