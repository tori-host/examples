# crimson finch

The bird log drawn on the [tori.host](https://tori.host/) homepage, as a real
app. It answers at `https://crimson-finch.tori.cloud`, the address the homepage
shows next to its terminal.

It is the kind of app a coding agent writes in an evening: one server file, no
dependencies, a `Dockerfile`. Run from this directory, `npx tori.host` finds the
`Dockerfile` and deploys a server app, which is what the homepage's terminal
shows.

## What it does

- Lists the birds spotted today, starting with the three on the homepage.
- A heart is a counter the server keeps. "Log a bird" adds the next bird from a
  fixed list.
- Nothing a visitor types is shown to anyone: there is no text input. A demo
  linked from a homepage with a free-text field is a billboard.
- The counts are in memory. An app on Tori naps when nobody visits and wakes on
  the next request, so the counts start over after a nap or a new deploy. The
  page says so, and shows when the server started.
- Writes are capped per minute for the whole process, and refused when a page
  on another site sends them.

One limit is accepted knowingly. The list and the cap belong to one copy of the
app. Tori runs a second copy of a service only when one copy has about seventy
requests in flight at once, which for this app means a flood rather than a busy
day; during one, each copy would show its own list. An app whose state must
agree with itself under load keeps it outside the process.

## Run it

```sh
node server.mjs          # http://localhost:8080
node --test              # the tests
```

Node.js 20 or newer. As a container, the way Tori runs it:

```sh
docker build -t crimson-finch .
docker run --rm --read-only -p 8080:8080 crimson-finch
```

The image listens on port 8080 and runs as a numeric non-root user; Tori
requires both of a server app.

## How the live one is deployed

By hand, from this directory, by an operator signed in to the account that owns
the app (`npx tori.host whoami`).

`tori.json` in this directory names the app the directory deploys to. It is not
in the repository: yours would name your app. **In a fresh checkout it does not
exist, and a deploy without it creates a new app under a new name** instead of
updating the demo. So bind the directory to the demo first, and read the file
back:

```sh
printf '{ "slug": "crimson-finch" }\n' > tori.json
cat tori.json
npx tori.host deploy
```

The deploy prints the address it went live at. It must be
`https://crimson-finch.tori.cloud`; any other name means the binding was
missing and a second app now exists, to be deleted.

Then check two things. That the deploy you just made is the one that is live,
by its id (the deploy printed it, and this names the latest attempt and its
status):

```sh
npx tori.host deploy status
```

And that a visitor gets the page, from outside. `/healthz` is not that check:
it answers `ok` without rendering anything. Ask for what the homepage links to,
and for the script the page needs:

```sh
curl -sS https://crimson-finch.tori.cloud/ | grep -c 'data-bird='
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://crimson-finch.tori.cloud/app.js
```

The first prints the number of birds on the list, three after a fresh start;
the second `200 text/javascript; charset=utf-8`. A `0`, or anything but a 200,
is a demo that is up and broken.

Last, that the two buttons work, which the page and its script loading do not
show: a change at the edge can make the app take the page's own clicks for
another site's. Send what the page's script sends, with the origin a browser
would add, and read the result back:

```sh
D=https://crimson-finch.tori.cloud
curl -sS -X POST -H "Origin: $D" "$D/api/birds/cloud-swift/heart"   # "hearts" is one more than before
curl -sS "$D/api/birds"                                             # the same count, read again
curl -sS -X POST -H "Origin: $D" "$D/api/birds"                     # 201 and a new bird, or 409 when the list is full
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://example.com' "$D/api/birds"   # 403
```

The last line is the control: if it does not answer 403, the three before it
did not test the check they were meant to pass. Then open the page in a browser
once and click both buttons; `curl` shows what the server accepts, not that the
script sends it.

The name stays taken for as long as the app exists, which is what keeps the
homepage's address from being handed to anyone else. Do not delete the app
without changing the homepage.

A first request after a nap takes longer than the ones after it. That is the
platform's idle behaviour, not a fault of the app.
