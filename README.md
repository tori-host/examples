# Tori examples

Small apps, each one stack that a coding agent commonly writes, each deployed
with one command and running for real on [Tori](https://tori.host/). Every one
is live on `tori.cloud`, where its page says that it is an example run by Tori.

| Example | What it is | Live |
| --- | --- | --- |
| [paper-lark](paper-lark) | A static site: HTML and CSS, no build step | <https://paper-lark.tori.cloud> |
| [sunny-tern](sunny-tern) | A single-page app: Vite and React | <https://sunny-tern.tori.cloud> |
| [crimson-finch](crimson-finch) | A Node.js server with its own Dockerfile | <https://crimson-finch.tori.cloud> |
| [misty-heron](misty-heron) | An Express server, built on Tori without a Dockerfile | <https://misty-heron.tori.cloud> |
| [amber-ibis](amber-ibis) | A FastAPI server, built on Tori without a Dockerfile | <https://amber-ibis.tori.cloud> |
| [mossy-starling](mossy-starling) | A Node.js server with Tori's managed Postgres | <https://mossy-starling.tori.cloud> |

## Deploy one

You need Node.js for the CLI. Nothing else needs installing: a server is built
on Tori, not on your machine.

```sh
git clone https://github.com/tori-host/examples
cd examples/paper-lark
npx tori.host
```

The first run signs you in (or signs you up: it is the same click), creates
an app under a new name of its own and writes that name to `tori.json`, so
the next run from the same directory updates the same app. Each example's
README says what the CLI makes of it and anything it needs beyond that one
command.

The examples ask search engines not to index them: each page has
`<meta name="robots" content="noindex" />`, and the servers also send
`X-Robots-Tag: noindex`. Take both out of your copy if you want it found.

The [documentation](https://docs.tori.host/) covers the rest: what decides
whether a directory is a static site or a service, what a container has to
do, environment variables, databases and custom domains.

## How this repository runs

Every example here is live, and stays current without anyone touching it:

- **Dependabot** updates every dependency, the base image, the actions and
  the tools the workflows run. Security fixes come as soon as an advisory is
  out; everything else waits three days after its release, so a version that
  is pulled for being broken or malicious never arrives.
- **Its pull requests merge themselves** when the tests pass: each example's
  own tests and its build, crimson-finch's on the Node of its image. Python
  dependencies are installed by hash, Node ones without install scripts.
- **Main is deployed** to tori.cloud by the same CLI a visitor runs, pinned,
  with a deploy token for that one app. Builds run in a job without secrets.
  Each deploy is then checked live, static sites down to the commit they
  serve; one that does not pass is rolled back to the last version that did,
  held until it changes, and reported in an issue.
- **Every half hour** each example is checked live. Every day `npm audit`,
  `pip-audit` and an image scan look for known advisories, and open an issue
  when one has a fix that has not arrived. Every week each example is rebuilt.

`examples.json` lists the examples, and is what the deploy and the checks read.

Pull requests are welcome; a maintainer reads one before it merges. Questions:
hello@tori.host.
