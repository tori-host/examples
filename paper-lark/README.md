# paper lark

A static site with no build step: `index.html`, `style.css` and
`favicon.svg`. It runs at <https://paper-lark.tori.cloud>, where it is an
example run by [Tori](https://tori.host/).

## Deploy your own

With Node.js installed, from this directory:

```sh
npx tori.host
```

The first run signs you in, creates a site under a new name of its own and
writes that name to `tori.json`; later runs update the same site. The CLI
publishes this directory because it holds `index.html` and nothing that looks
like a server.

Everything in the directory is published except `node_modules`, `.git` and
`tori.json`, so this README and `.gitignore` are served too. Keep a site's files in a directory
of their own when there is anything next to them that should not be public,
and name that directory: `npx tori.host deploy ./site`.

## Run it

Open `index.html` in a browser, or serve the directory with anything that
serves files:

```sh
npx serve .
```
