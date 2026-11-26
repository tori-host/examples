# amber ibis

A FastAPI server with no Dockerfile: a small JSON API of wading birds, a page
that lists them, and the API description FastAPI draws at `/docs`. It runs at
<https://amber-ibis.tori.cloud>, where it is an example run by
[Tori](https://tori.host/).

## Deploy your own

The CLI runs on Node.js; the build runs on Tori, so Python is not needed on
your machine. From this directory:

```sh
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
pip install -r requirements-dev.txt
python main.py           # http://localhost:8080, the API at /docs
python -m pytest
```
