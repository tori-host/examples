# drift albatross

A static site built with Astro: a travel journal of slow trains and long walks
in Central Europe, six short Markdown posts with a page each, a page per tag,
an about page and an RSS feed. The trips are made up. It runs at
<https://drift-albatross.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

No page loads any JavaScript. Astro sends none unless a component asks for it,
and nothing here does, so what Tori serves is HTML, one stylesheet, an icon and
the feed. The tests hold the build to that.

## Deploy your own

With Node.js 22.23.4 or newer (what this Astro release needs), from this
directory:

```sh
git clone https://github.com/tori-host/examples
cd examples/drift-albatross
npm install
npx tori.host
```

With no `dist/` yet, the CLI runs `npm run build` and publishes `dist/` as a
static site. It is a static site to the CLI because nothing in `package.json`
is a server: Astro without an adapter writes files. Adding one, such as
`@astrojs/node`, makes Astro build a server, and the CLI would then build and
run it as a service instead. The first run signs you in, creates a site under
a new name of its own and writes that name to `tori.json`; later runs update
the same site.

Once `dist/` exists, the CLI publishes it as it is, so build again before each
deploy:

```sh
npm run build && npx tori.host
```

The feed's links are absolute, made from `site` in `astro.config.mjs`. Change
it to your site's own address, or your feed will link to this one.

## How the pages are served

Astro writes every page as a directory with an `index.html`:
`/tags/rail/` is `dist/tags/rail/index.html`. Tori answers a path ending in a
slash with that directory's `index.html`, and a path with no extension, such as
`/tags/rail`, with the file of that name or, when there is none, the
directory's `index.html`. So every page works with or without its last slash.

A path that is no page at all, such as `/no-such-trip`, is answered with the
first page, because Tori answers any path that names no file with the site's
`index.html` (that is what lets a single-page app draw its own pages). A
missing file with an extension, such as `/missing.png`, is Tori's own 404.
The build also writes `404.html`, the not-found page in this journal's style:
`npm run preview` and hosts that look for that file answer with it, but Tori
does not, so on Tori it is only seen at `/404.html`.

## Run it

```sh
npm install
npm run dev      # http://localhost:4321
npm test         # builds, then checks dist/
```

`npm test` builds the site and then reads `dist/` as Tori would serve it:
every post has a page, each tag page lists exactly the posts that carry the
tag, the feed is well-formed and lists every post, every page asks not to be
indexed and carries no script, and every link names a file that is there.
`test/check.test.mjs` shows each of those checks failing on a page or a feed
that breaks it.

Astro sends anonymous usage data to its makers when it builds, in CI too.
`npx astro telemetry disable` turns that off on your machine, and
`ASTRO_TELEMETRY_DISABLED=1` in the environment turns it off for one run.
