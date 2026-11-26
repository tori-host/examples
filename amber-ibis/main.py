"""amber ibis: an API of Czech public holidays and working days, a FastAPI
server that Tori builds from source.

There is no Dockerfile. Tori sees FastAPI in requirements.txt and builds an
image that serves `app` from this file on port 8080. `python main.py` does the
same on your machine. The calendar itself is in czech_holidays.py.
"""

import os
from datetime import date, datetime, timezone
from html import escape
from pathlib import Path

from fastapi import FastAPI, HTTPException, Path as PathParam, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import czech_holidays as cal

LOCATION = "Prague, EU"
SOURCE = "https://github.com/tori-host/examples/tree/main/amber-ibis"
STARTED_AT = datetime.now(timezone.utc).replace(microsecond=0)
# The longest range /api/working-days counts: five years, leap days included.
MAX_RANGE_DAYS = 5 * 365 + 2

DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"

CSP = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
# FastAPI's /docs and /redoc pages load their script and stylesheet from a
# CDN, which the CSP above would block. They get no CSP; everything else does.
DOC_PAGES = {"/docs", "/docs/oauth2-redirect", "/redoc"}


class Holiday(BaseModel):
    date: date
    name: str
    weekday: str


class Holidays(BaseModel):
    year: int
    holidays: list[Holiday]


class WorkingDays(BaseModel):
    # Named as the query names them; `from` is a keyword in Python.
    start: date = Field(serialization_alias="from")
    end: date = Field(serialization_alias="to")
    days: int
    working_days: int


class Day(BaseModel):
    date: date
    weekday: str
    working_day: bool
    holiday: str | None


app = FastAPI(
    title="amber ibis",
    summary="Czech public holidays and working days: an example FastAPI server run by Tori.",
    description=(
        f"Public holidays of Czechia from {cal.FIRST_YEAR} to {cal.LAST_YEAR}, as the law of each year had them, "
        f"and working days: Monday to Friday, less the holidays. Served from {LOCATION}. The source is at {SOURCE}."
    ),
    version="1.0.0",
)


@app.middleware("http")
async def headers_on_every_answer(request: Request, call_next):
    response = await call_next(request)
    # The pages on tori.host are the ones meant to be found; this copy is not.
    # A header, not only the page's meta tag, so /docs and the API say so too.
    response.headers["X-Robots-Tag"] = "noindex"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path not in DOC_PAGES:
        response.headers["Content-Security-Policy"] = CSP
    return response


@app.exception_handler(RequestValidationError)
async def refused_without_repeating_it(request: Request, error: RequestValidationError):
    # FastAPI's own answer repeats the value it refused, so an address could
    # make this domain show any text its author likes. The same answer, less
    # that: what was wrong, and where, in FastAPI's own words.
    detail = [{key: item[key] for key in ("type", "loc", "msg") if key in item} for item in error.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})


def parse_date(text: str) -> date:
    """A calendar date in a supported year. A date that does not exist
    (2026-02-30) is a 422, like any other value FastAPI refuses."""
    try:
        day = date.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a calendar date (YYYY-MM-DD).") from None
    if not cal.FIRST_YEAR <= day.year <= cal.LAST_YEAR:
        raise HTTPException(status_code=422, detail=f"Dates are from {cal.FIRST_YEAR} to {cal.LAST_YEAR}.")
    return day


def holiday_view(holiday: cal.Holiday) -> Holiday:
    return Holiday(date=holiday.date, name=holiday.name, weekday=holiday.date.strftime("%A"))


def day_view(day: date) -> Day:
    holiday = cal.holiday_on(day)
    return Day(date=day, weekday=day.strftime("%A"), working_day=cal.is_working_day(day), holiday=holiday.name if holiday else None)


@app.get("/api/holidays/{year}", response_model=Holidays, summary="The public holidays of a year")
def holidays_of(year: int = PathParam(ge=cal.FIRST_YEAR, le=cal.LAST_YEAR, description="A year from 1990 to 2100")):
    return Holidays(year=year, holidays=[holiday_view(h) for h in cal.holidays(year)])


@app.get(
    "/api/working-days",
    response_model=WorkingDays,
    summary="Count the working days in a range",
    description="Both dates are included. The range is at most five years (1827 days).",
    responses={400: {"description": "The range ends before it starts, or is longer than five years"}},
)
def count_working_days(
    start: str = Query(alias="from", pattern=DATE_PATTERN, description="The first day, YYYY-MM-DD"),
    end: str = Query(alias="to", pattern=DATE_PATTERN, description="The last day, YYYY-MM-DD"),
):
    first, last = parse_date(start), parse_date(end)
    if last < first:
        raise HTTPException(status_code=400, detail="The range ends before it starts: `to` comes before `from`.")
    days = (last - first).days + 1
    if days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"A range is at most five years ({MAX_RANGE_DAYS} days).")
    return WorkingDays(start=first, end=last, days=days, working_days=cal.working_days(first, last))


@app.get("/api/is-working-day/{day}", response_model=Day, summary="Whether a date is a working day")
def is_working_day(day: str = PathParam(pattern=DATE_PATTERN, description="A date, YYYY-MM-DD")):
    return day_view(parse_date(day))


@app.get("/healthz", response_class=PlainTextResponse, include_in_schema=False)
def healthz():
    return PlainTextResponse("ok\n", headers={"Cache-Control": "no-store"})


def example(path: str, answer: str) -> str:
    return f'<li><a href="{escape(path)}"><code>{escape(path)}</code></a><br />{escape(answer)}</li>'


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def home():
    # Everything on the page is computed here, from today's date; nothing a
    # request carries is shown.
    today = datetime.now(timezone.utc).date()
    year = today.year
    rows = "".join(
        f"<tr><td>{h.date.strftime('%a %d %b')}</td><td>{escape(h.name)}</td></tr>" for h in cal.holidays(year)
    )
    upcoming = next((h for h in cal.holidays(year) + cal.holidays(min(year + 1, cal.LAST_YEAR)) if h.date >= today), None)
    first, last = date(year, 1, 1), date(year, 12, 31)
    examples = "".join(
        [
            example(f"/api/holidays/{year}", f"{len(cal.holidays(year))} holidays in {year}."),
            example(
                f"/api/working-days?from={first}&to={last}",
                f"{cal.working_days(first, last)} working days in {year}.",
            ),
            example(
                f"/api/is-working-day/{today}",
                f"Today, {today:%A %d %B}, is {'a working day' if cal.is_working_day(today) else 'not a working day'}.",
            ),
            example(
                f"/api/is-working-day/{year}-12-24",
                f"24 December {year} is {'a working day' if cal.is_working_day(date(year, 12, 24)) else 'a day off'}.",
            ),
        ]
    )
    next_line = f"<p>The next one is {escape(upcoming.name)}, on {upcoming.date:%A %d %B %Y}.</p>" if upcoming else ""
    started = STARTED_AT.strftime("%Y-%m-%d %H:%M:%S")
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>amber ibis — Czech holidays, a FastAPI server on Tori</title>
    <meta name="description" content="Czech public holidays and working days: an example FastAPI server run by Tori, built from source without a Dockerfile, in {LOCATION}." />
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
      <p class="lead">Czech public holidays, and the working days between two dates, as a small JSON API. The whole API
        is described at <a href="/docs"><code>/docs</code></a>, which FastAPI draws from the code.</p>

      <h2>The holidays of {year}</h2>
      <div class="card"><table class="holidays"><tbody>{rows}</tbody></table></div>
      {next_line}

      <h2>Try it</h2>
      <ul class="examples">{examples}</ul>

      <h2>What it counts</h2>
      <ul>
        <li>Every public holiday in Czechia is a day off, and one that falls on a weekend is not moved. A working day is
          Monday to Friday, less the holidays.</li>
        <li>Years from {cal.FIRST_YEAR} to {cal.LAST_YEAR}, each with the holidays its law had: Good Friday from 2016,
          28 September and 17 November from 2000, Victory Day on 9 May until 1991. Easter is computed with the
          Gregorian algorithm.</li>
        <li>A range for <code>/api/working-days</code> includes both dates and is at most five years long.</li>
      </ul>

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
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
