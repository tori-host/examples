import re
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import czech_holidays as cal
from main import app

client = TestClient(app)


def dates(year):
    return {h["date"]: h["name"] for h in client.get(f"/api/holidays/{year}").json()["holidays"]}


# Published dates of Western Easter, including the earliest and latest
# possible ones (22 March 2285 is out of range; 23 March 2008, 25 April 2038).
@pytest.mark.parametrize(
    "year, easter",
    [(1990, "1990-04-15"), (2000, "2000-04-23"), (2008, "2008-03-23"), (2019, "2019-04-21"), (2024, "2024-03-31"),
     (2025, "2025-04-20"), (2026, "2026-04-05"), (2038, "2038-04-25"), (2100, "2100-03-28")],
)
def test_easter_sunday(year, easter):
    assert cal.easter_sunday(year).isoformat() == easter


def test_the_holidays_of_2026():
    days = dates(2026)
    assert list(days) == [
        "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-08", "2026-07-05", "2026-07-06",
        "2026-09-28", "2026-10-28", "2026-11-17", "2026-12-24", "2026-12-25", "2026-12-26",
    ]
    assert days["2026-04-03"] == "Good Friday"
    assert days["2026-04-06"] == "Easter Monday"
    first = client.get("/api/holidays/2026").json()["holidays"][0]
    assert first["weekday"] == "Thursday"


def test_each_year_has_the_holidays_of_its_law():
    assert "2015-04-03" not in dates(2015) and "2015-04-06" in dates(2015)  # no Good Friday before 2016
    assert dates(2016)["2016-03-25"] == "Good Friday"
    assert "1999-09-28" not in dates(1999) and "1999-11-17" not in dates(1999)
    assert "2000-09-28" in dates(2000) and "2000-11-17" in dates(2000)
    assert "1991-05-09" in dates(1991) and "1991-05-08" not in dates(1991)
    assert "1992-05-08" in dates(1992) and "1992-05-09" not in dates(1992)
    assert len(dates(1990)) == 10 and len(dates(2026)) == 13


def test_a_year_out_of_range_is_refused():
    for year in ("1989", "2101", "-1", "20x6", "99999999999999999999"):
        assert client.get(f"/api/holidays/{year}").status_code == 422, year


def test_working_days_in_a_range():
    # April 2026: 22 weekdays, less Good Friday and Easter Monday.
    april = client.get("/api/working-days", params={"from": "2026-04-01", "to": "2026-04-30"}).json()
    assert april == {"from": "2026-04-01", "to": "2026-04-30", "days": 30, "working_days": 20}
    # The published figure for 2026: 261 weekdays, 11 holidays on one of them.
    year = client.get("/api/working-days", params={"from": "2026-01-01", "to": "2026-12-31"}).json()
    assert year["working_days"] == 250
    # Both ends count: a single working day, and a single holiday.
    assert client.get("/api/working-days", params={"from": "2026-04-07", "to": "2026-04-07"}).json()["working_days"] == 1
    assert client.get("/api/working-days", params={"from": "2026-04-03", "to": "2026-04-03"}).json()["working_days"] == 0


def test_working_days_agree_with_counting_one_day_at_a_time():
    for start, end in [(date(1990, 1, 1), date(1994, 12, 30)), (date(2015, 12, 29), date(2016, 4, 1)), (date(2096, 1, 3), date(2100, 12, 31))]:
        slow = sum(1 for i in range((end - start).days + 1) if cal.is_working_day(start + timedelta(days=i)))
        assert cal.working_days(start, end) == slow, (start, end)


def test_an_inverted_or_too_long_range_is_refused():
    inverted = client.get("/api/working-days", params={"from": "2026-05-01", "to": "2026-04-30"})
    assert inverted.status_code == 400
    assert client.get("/api/working-days", params={"from": "2024-01-01", "to": "2028-12-31"}).status_code == 200
    too_long = client.get("/api/working-days", params={"from": "2024-01-01", "to": "2029-01-01"})
    assert too_long.status_code == 400
    assert "five years" in too_long.json()["detail"]


@pytest.mark.parametrize(
    "params",
    [{"from": "2026-01-01"}, {"to": "2026-01-01"}, {"from": "2026-02-30", "to": "2026-03-01"}, {"from": "1989-12-31", "to": "1990-01-02"},
     {"from": "2026-1-1", "to": "2026-01-02"}, {"from": "20260101", "to": "2026-01-02"}, {"from": "2026-01-01T00:00", "to": "2026-01-02"}],
)
def test_a_malformed_range_is_refused(params):
    assert client.get("/api/working-days", params=params).status_code == 422


def test_a_refusal_does_not_repeat_what_was_sent():
    for path, params in [
        ("/api/working-days", {"from": "Send money to <b>us</b>", "to": "2026-01-01"}),
        ("/api/holidays/Send-money-to-us", {}),
        ("/api/is-working-day/Send-money-to-us", {}),
    ]:
        res = client.get(path, params=params)
        assert res.status_code == 422, path
        assert "money" not in res.text, path
        assert res.json()["detail"][0]["loc"][0] in ("query", "path")


def test_is_working_day():
    assert client.get("/api/is-working-day/2026-04-03").json() == {
        "date": "2026-04-03", "weekday": "Friday", "working_day": False, "holiday": "Good Friday",
    }
    assert client.get("/api/is-working-day/2026-04-07").json()["working_day"] is True
    saturday = client.get("/api/is-working-day/2026-04-04").json()
    assert saturday["working_day"] is False and saturday["holiday"] is None
    # A holiday on a Sunday is not moved to Monday.
    assert client.get("/api/is-working-day/2026-07-06").json()["working_day"] is False
    assert client.get("/api/is-working-day/2026-07-07").json()["working_day"] is True
    for bad in ("2026-13-01", "2026-02-29", "2101-01-01", "today", "2026-04-03x"):
        assert client.get(f"/api/is-working-day/{bad}").status_code == 422, bad


def test_the_page_shows_live_answers_and_says_it_is_an_example():
    res = client.get("/")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    assert 'data-example="amber-ibis"' in res.text
    assert "an example run by" in res.text
    assert "Easter Monday" in res.text
    # Every example the page links to answers.
    for path in re.findall(r'<a href="(/api/[^"]+)">', res.text):
        assert client.get(path.replace("&amp;", "&")).status_code == 200, path


def test_the_static_files_and_the_api_description_are_served():
    assert client.get("/static/style.css").status_code == 200
    assert client.get("/static/favicon.svg").status_code == 200
    # The test client sends `%2e%2e` as written; a literal `..` it would resolve itself.
    for path in ("/static/main.py", "/static/%2e%2e/main.py", "/static/%2e%2e%2fmain.py", "/main.py", "/czech_holidays.py"):
        res = client.get(path)
        assert res.status_code == 404, path
        assert "from fastapi" not in res.text and "def easter_sunday" not in res.text, path
    schema = client.get("/openapi.json").json()
    assert {"/api/holidays/{year}", "/api/working-days", "/api/is-working-day/{day}"} <= set(schema["paths"])
    assert "/" not in schema["paths"]
    assert client.get("/docs").status_code == 200
    assert client.get("/healthz").text == "ok\n"


def test_every_answer_tells_search_engines_to_leave_this_copy_alone():
    assert '<meta name="robots" content="noindex" />' in client.get("/").text
    for path in ("/", "/api/holidays/2026", "/api/holidays/1800", "/docs", "/openapi.json", "/static/style.css", "/missing"):
        res = client.get(path)
        assert res.headers.get("x-robots-tag") == "noindex", path
        assert res.headers.get("x-content-type-options") == "nosniff", path


def test_a_strict_csp_everywhere_but_the_pages_fastapi_draws_from_a_cdn():
    for path in ("/", "/api/holidays/2026", "/api/holidays/1800", "/openapi.json", "/missing"):
        assert "default-src 'none'" in client.get(path).headers["content-security-policy"], path
    assert "content-security-policy" not in client.get("/docs").headers
