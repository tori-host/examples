from fastapi.testclient import TestClient

from main import BIRDS, app

client = TestClient(app)


def test_the_page_lists_every_bird_and_says_it_is_an_example():
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    assert 'data-example="amber-ibis"' in res.text
    assert "an example run by" in res.text
    for bird in BIRDS:
        assert bird.name in res.text


def test_the_api_lists_and_searches():
    assert [b["id"] for b in client.get("/api/birds").json()] == [b.id for b in BIRDS]
    storks = client.get("/api/birds", params={"q": "STORK"}).json()
    assert {b["id"] for b in storks} == {"white-stork", "black-stork"}
    assert client.get("/api/birds", params={"q": "Threskiornithidae"}).json()[0]["id"] == "glossy-ibis"
    assert client.get("/api/birds", params={"q": "penguin"}).json() == []


def test_a_search_term_is_bounded():
    assert client.get("/api/birds", params={"q": "x" * 41}).status_code == 422


def test_one_bird_and_a_missing_one():
    assert client.get("/api/birds/common-crane").json()["latin"] == "Grus grus"
    missing = client.get("/api/birds/dodo")
    assert missing.status_code == 404
    assert "GET /api/birds" in missing.json()["detail"]


def test_the_static_files_and_the_api_description_are_served():
    assert client.get("/static/style.css").status_code == 200
    assert client.get("/static/favicon.svg").status_code == 200
    # The test client sends `%2e%2e` as written; a literal `..` it would resolve itself.
    for path in ("/static/main.py", "/static/%2e%2e/main.py", "/static/%2e%2e%2fmain.py", "/main.py"):
        res = client.get(path)
        assert res.status_code == 404, path
        assert "from fastapi" not in res.text, path
    schema = client.get("/openapi.json").json()
    assert "/api/birds" in schema["paths"]
    assert "/" not in schema["paths"]
    assert client.get("/healthz").text == "ok\n"


def test_every_answer_tells_search_engines_to_leave_this_copy_alone():
    assert '<meta name="robots" content="noindex" />' in client.get("/").text
    for path in ("/", "/api/birds", "/api/birds/dodo", "/docs", "/openapi.json", "/static/style.css", "/missing"):
        assert client.get(path).headers.get("x-robots-tag") == "noindex", path
