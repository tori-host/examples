# copper owl

A plain PHP server with no framework, no dependencies and no Dockerfile: an
invoice form that draws a print-ready invoice, with every line, the VAT for
each rate and the total worked out exactly. It runs at
<https://copper-owl.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

## Deploy your own

The CLI runs on Node.js; the build runs on Tori, so PHP is not needed on your
machine. From this directory:

```sh
npx tori.host
```

The CLI sees `index.php` and deploys the directory as a service. Tori builds
it with Railpack, which puts the app in `/app` on a FrankenPHP image for
PHP 8.4 (its default, as nothing here asks for another) and serves it on port
8080. There is no `composer.json`, so there is nothing to install. The first
run signs you in, creates a service under a new name of its own and writes
that name to `tori.json`; later runs update the same service.

### Why there is a Caddyfile

Railpack serves the whole app directory as FrankenPHP's document root: any
file in it is served as it is, and any `.php` file is run if a request names
it. That would put `src/`, `tests/` and this README on the web. When the app
has a `Caddyfile` at its root, Railpack uses that one instead. This one sends
every request to `index.php`, whatever the path, so nothing is served
directly. It also refuses any request body over 64 kB before PHP reads it.

## What it shows

- `GET /` is the form: seller, buyer, invoice number, dates, a currency
  (CZK, EUR or USD) and up to ten lines, each with a VAT rate of 0, 12 or
  21 %.
- `POST /invoice` draws the invoice. Print it, or choose Save as PDF in the
  browser's print dialog; the stylesheet has print rules. "Change something"
  posts the same values back and you get the form again, filled in.
- No floats. A price is read from its text straight into whole cents, and a
  quantity into whole thousandths. A line total is quantity times price,
  rounded half up to the cent once. VAT is worked out per rate on the sum of
  that rate's lines, and rounded the same way.
- The server keeps nothing: no database, no file, no session, and no log
  line with anything typed into the form.

The page draws text a visitor typed, on a domain that is not theirs. So:

- An invoice is drawn only in answer to a form posted from this page. A post
  from another site is refused with 403, checked with `Sec-Fetch-Site`, or
  with `Origin` against `Host` when a browser does not send that. Another app
  on `tori.cloud` counts as another site.
- No URL draws submitted text: `GET /invoice?…` is a 405, and the query on
  `/` is ignored. There is no link that shows an invoice.
- Every invoice says "SAMPLE — made with an example app, not a real invoice"
  at the top and the foot, with a watermark too. The mark sits outside every
  field a visitor fills in, and it is on the printed copy too.
- Every field has a length limit, and quantities and prices have a range. All
  text is HTML-escaped, and no link is made from it. Control characters and
  text-direction overrides are refused. A form that breaks a rule gets a 400,
  with the form and a list of what to fix.
- Every response has a strict Content-Security-Policy with no script at all,
  plus `nosniff`, a Referrer-Policy and `X-Robots-Tag: noindex`.

## How it is put together

- `index.php` is the front controller and the only file a request reaches.
- `src/app.php` holds the routes, the headers and the pages; `src/invoice.php`
  reads the form and does the sums; `src/page.html` is the page around them.
- `assets/` holds the stylesheet and the icon, which `index.php` serves.
- `Caddyfile` is FrankenPHP's configuration on Tori, described above.

## Run it

PHP 8.3 or newer, with nothing to install:

```sh
php -S localhost:8080 index.php   # http://localhost:8080
php tests/run.php
```

`index.php` is given to `php -S` as its router, so every path goes through it
here too. `tests/run.php` tests the sums and the form rules directly, then
runs every HTTP case against a `php -S` it starts itself.

Without PHP, with Docker:

```sh
docker run --rm -v "$PWD:/app" -w /app php:8.4-cli-alpine php tests/run.php
tests/frankenphp.sh
```

`tests/frankenphp.sh` builds `tests/frankenphp/Dockerfile`: FrankenPHP with
this `Caddyfile`, laid out the way Railpack lays it out. It runs the same
tests against that, so the routing and the body limit in the `Caddyfile` are
tested too. Tori does not build that Dockerfile, because it is not at the root
of the directory.
