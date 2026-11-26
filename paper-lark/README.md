# paper lark

The landing page of Lark Café, a café that does not exist: a menu with
prices, opening hours, a short story and an address. It is a static site with
no build step, three files: `index.html`, `style.css` and `favicon.svg`. It
runs at <https://paper-lark.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

The café, its address and its prices are made up, and the page says so. It
gives no phone number and no email address, so nobody is sent to a real one.

## Deploy your own

With Node.js installed:

```sh
git clone https://github.com/tori-host/examples
cd examples/paper-lark
npx tori.host
```

The CLI publishes this directory as a static site, because it holds
`index.html` and nothing that looks like a server: no `package.json`, no
Dockerfile. Tori stores the files and serves them as they are, over HTTPS.
Nothing runs for the site, so it never naps.

The first run signs you in, creates a site under a new name of its own and
writes that name to `tori.json`; later runs from the same directory update the
same site.

Everything in the directory is published except `node_modules`, `.git` and
`tori.json`, so this README and `.gitignore` are served too. Keep a site's
files in a directory of their own when there is anything next to them that
should not be public, and name that directory: `npx tori.host deploy ./site`.

## Make it yours

Change the text in `index.html` and the colours at the top of `style.css`,
then run `npx tori.host` again. Take out
`<meta name="robots" content="noindex" />` if you want search engines to find
the page.

## Run it

Open `index.html` in a browser, or serve the directory with anything that
serves files:

```sh
npx serve .
```

There are no tests of its own: the repository's `test/examples.test.mjs`
checks that the page carries its marker, the noindex tag and the link to its
source.
