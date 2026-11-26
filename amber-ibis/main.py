"""amber ibis: a FastAPI server that Tori builds from source.

There is no Dockerfile. Tori sees FastAPI in requirements.txt and builds an
image that serves `app` from this file on port 8080. `python main.py` does the
same on your machine.
"""

import os
from datetime import datetime, timezone
from html import escape
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

LOCATION = "Prague, EU"
SOURCE = "https://github.com/tori-host/examples/tree/main/amber-ibis"
STARTED_AT = datetime.now(timezone.utc).replace(microsecond=0)


class Bird(BaseModel):
    id: str
    name: str
    latin: str
    family: str


BIRDS = [
    Bird(id="glossy-ibis", name="glossy ibis", latin="Plegadis falcinellus", family="Threskiornithidae"),
    Bird(id="eurasian-spoonbill", name="Eurasian spoonbill", latin="Platalea leucorodia", family="Threskiornithidae"),
    Bird(id="grey-heron", name="grey heron", latin="Ardea cinerea", family="Ardeidae"),
    Bird(id="little-egret", name="little egret", latin="Egretta garzetta", family="Ardeidae"),
    Bird(id="white-stork", name="white stork", latin="Ciconia ciconia", family="Ciconiidae"),
    Bird(id="black-stork", name="black stork", latin="Ciconia nigra", family="Ciconiidae"),
    Bird(id="common-crane", name="common crane", latin="Grus grus", family="Gruidae"),
    Bird(id="mallard", name="mallard", latin="Anas platyrhynchos", family="Anatidae"),
]
BY_ID = {bird.id: bird for bird in BIRDS}

PAGE_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store",
}

app = FastAPI(
    title="amber ibis",
    summary="An example FastAPI server run by Tori.",
    description=f"A small list of wading birds, served from {LOCATION}. The source is at {SOURCE}.",
    version="1.0.0",
)


@app.middleware("http")
async def not_for_search_engines(request: Request, call_next):
    # The pages on tori.host are the ones meant to be found; this copy is not.
    # A header, not only the page's meta tag, so /docs and the API say so too.
    response = await call_next(request)
    response.headers["X-Robots-Tag"] = "noindex"
    return response


def matching(q: str | None) -> list[Bird]:
    """The birds whose name, Latin name or family contains `q`, ignoring case."""
    if not q:
        return BIRDS
    needle = q.casefold()
    return [b for b in BIRDS if needle in b.name.casefold() or needle in b.latin.casefold() or needle in b.family.casefold()]


@app.get("/api/birds", response_model=list[Bird], summary="List the birds, or search them")
def list_birds(q: str | None = Query(default=None, max_length=40, description="Part of a name, a Latin name or a family")):
    return matching(q)


@app.get("/api/birds/{bird_id}", response_model=Bird, summary="One bird", responses={404: {"description": "No such bird"}})
def get_bird(bird_id: str):
    bird = BY_ID.get(bird_id)
    if bird is None:
        raise HTTPException(status_code=404, detail="No such bird. GET /api/birds lists them.")
    return bird


@app.get("/healthz", response_class=PlainTextResponse, include_in_schema=False)
def healthz():
    return PlainTextResponse("ok\n", headers={"Cache-Control": "no-store"})


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def home():
    rows = "".join(
        f'<li><a href="/api/birds/{escape(b.id)}">{escape(b.name)}</a> <i>{escape(b.latin)}</i></li>' for b in BIRDS
    )
    started = STARTED_AT.strftime("%Y-%m-%d %H:%M:%S")
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>amber ibis — a FastAPI server on Tori</title>
    <meta name="description" content="An example FastAPI server run by Tori, built from source without a Dockerfile, in {LOCATION}." />
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
    <link rel="stylesheet" href="/static/style.css" />
  </head>
  <body data-example="amber-ibis">
    <main>
      <header>
        <img src="/static/favicon.svg" alt="" width="36" height="36" />
        <h1>amber ibis</h1>
        <span class="tag">FastAPI server</span>
      </header>
      <p class="lead">A small API of wading birds. Every bird below is also JSON, and the whole API is described at
        <a href="/docs"><code>/docs</code></a>, which FastAPI draws from the code.</p>
      <div class="card"><ul>{rows}</ul></div>
      <p>Search it: <a href="/api/birds?q=stork"><code>/api/birds?q=stork</code></a>.</p>

      <h2>How it runs</h2>
      <ul>
        <li>There is no Dockerfile. Tori finds FastAPI in <code>requirements.txt</code>, builds an image from the source
          and serves <code>app</code> from <code>main.py</code>.</li>
        <li>When nobody visits for a while the server naps, and the next request wakes it, which takes a moment longer
          than the ones after it.</li>
        <li>This copy of the server started <time datetime="{STARTED_AT.isoformat()}">{started} UTC</time>.</li>
      </ul>

      <h2>Deploy your own</h2>
      <p>With Node.js installed (the CLI runs on it; the build runs on Tori):</p>
      <pre><code>git clone https://github.com/tori-host/examples
cd examples/amber-ibis
npx tori.host</code></pre>
      <p>The first run creates a service under a new name of its own and writes it to <code>tori.json</code>, so that
        the next run updates the same service.</p>

      <footer>
        <p>This is an example run by <a href="https://tori.host/">Tori</a>, in {LOCATION}. The source is on
          <a href="{SOURCE}">GitHub</a>.</p>
      </footer>
    </main>
  </body>
</html>
"""
    return HTMLResponse(html, headers=PAGE_HEADERS)


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
