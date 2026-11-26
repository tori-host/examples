# Tori examples

Small apps, each one stack that a coding agent commonly writes, each deployed
with one command and running for real on [Tori](https://tori.host/). Every one
is live on `tori.cloud`, where its page says that it is an example run by Tori.

| Example | What it is | Stack | Live |
| --- | --- | --- | --- |
| [paper-lark](paper-lark) | A café's landing page | HTML and CSS, no build step | <https://paper-lark.tori.cloud> |
| [sunny-tern](sunny-tern) | Split the bill | Vite and React, a static single-page app | <https://sunny-tern.tori.cloud> |
| [drift-albatross](drift-albatross) | A travel journal | Astro, Markdown built into a static site | <https://drift-albatross.tori.cloud> |
| [crimson-finch](crimson-finch) | The bird log on the tori.host homepage | Node.js with its own Dockerfile | <https://crimson-finch.tori.cloud> |
| [misty-heron](misty-heron) | Placeholder images | Express, built on Tori without a Dockerfile | <https://misty-heron.tori.cloud> |
| [saffron-wren](saffron-wren) | Recipes, scaled to your table | Next.js, built and run on Tori | <https://saffron-wren.tori.cloud> |
| [amber-ibis](amber-ibis) | Czech holidays and working days | FastAPI, built on Tori without a Dockerfile | <https://amber-ibis.tori.cloud> |
| [steel-swift](steel-swift) | A status page for these examples | Go, standard library only | <https://steel-swift.tori.cloud> |
| [copper-owl](copper-owl) | An invoice, ready to print | PHP on FrankenPHP, no framework | <https://copper-owl.tori.cloud> |
| [mossy-starling](mossy-starling) | A lunch poll | Node.js with Tori's managed Postgres | <https://mossy-starling.tori.cloud> |

None of them lets one visitor publish anything another visitor sees, and none
fetches an address a visitor gives it: they are public, on Tori's own domain,
and stay boring to abuse.

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
