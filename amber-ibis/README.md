# amber ibis

An API of Czech public holidays and working days: the holidays of a year,
how many working days lie between two dates, and whether a date is one. A
FastAPI server with no Dockerfile, with a page that explains it and the API
description FastAPI draws at `/docs`. It runs at
<https://amber-ibis.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

## Use it

| Request | Answer |
| --- | --- |
| `GET /api/holidays/2026` | The year's holidays: date, English name, weekday |
| `GET /api/working-days?from=2026-01-01&to=2026-12-31` | `{"from", "to", "days", "working_days"}`, both dates included |
| `GET /api/is-working-day/2026-04-03` | `{"date", "weekday", "working_day", "holiday"}` |

- Years run from 1990 to 2100, and each year has the holidays the law of that
  year had: Good Friday from 2016, 28 September and 17 November from 2000,
  Victory Day on 9 May until 1991 and on 8 May since. Easter is computed with
  the anonymous Gregorian algorithm, so Easter Sunday 2026 is 5 April, Good
  Friday 3 April and Easter Monday 6 April.
- A working day is Monday to Friday, less the public holidays. A holiday that
  falls on a weekend is not moved, as Czech law has it.
- A range is at most five years (1827 days). One that ends before it starts,
  or is longer, is a `400`; a date that is not `YYYY-MM-DD`, does not exist or
  is out of range is a `422`. A refusal never repeats the value it refused.

`czech_holidays.py` is the calendar on its own, with the laws it follows
named in its docstring; `main.py` is the API and the page. Every answer
carries a strict `Content-Security-Policy` except `/docs` and `/redoc`:
FastAPI draws those with a script and a stylesheet from a CDN, which that
policy would block.

## Deploy your own

The CLI runs on Node.js; the build runs on Tori, so Python is not needed on
your machine:

```sh
git clone https://github.com/tori-host/examples
cd examples/amber-ibis
npx tori.host
```

The CLI sees FastAPI in `requirements.txt` and deploys the directory as a
service. Tori builds an image from the source, installs `requirements.txt`
and serves `app` from `main.py` on port 8080. The first run signs you in,
creates a service under a new name of its own and writes that name to
`tori.json`; later runs update the same service.

`requirements-dev.txt` holds what the tests need. The build reads only
`requirements.txt`, so test tools do not end up in the image.

Both are compiled from the `.in` file of the same name with
`pip-compile --generate-hashes --strip-extras`: every package the server
installs, its dependencies too, at one version with its hash. A build gets
exactly what the tests ran against, and a changed download is refused.

## Run it

Python 3.11 or newer:

```sh
python -m venv .venv && . .venv/bin/activate
pip install --require-hashes -r requirements-dev.txt
python main.py           # http://localhost:8080, the API at /docs
python -m pytest
```
