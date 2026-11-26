"""Czech public holidays and working days, with no web framework around them.

Every public holiday in Czechia is a day off, and one that falls on a
weekend is not moved to a weekday. So a working day is Monday to Friday,
less the holidays that fall on one.

The list follows the law in force in each year since 1990, not today's list
carried backwards:

- 1990: the federal Act 167/1990 and the Czech National Council's Act
  204/1990 made 5 and 6 July holidays and 24 December a day off. 9 May,
  Liberation Day, was kept.
- 1992: Act 218/1991, promulgated after 9 May 1991, moved it to 8 May.
- 2000: Act 245/2000, in force from its promulgation that summer, added
  28 September and 17 November. It is the law that still applies.
- 2016: an amendment (Act 359/2015) added Good Friday.

Each day has today's English name; 9 May, no longer a holiday, has the one
it had then.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from functools import cache

FIRST_YEAR = 1990
LAST_YEAR = 2100


@dataclass(frozen=True)
class Holiday:
    date: date
    name: str


# (month, day, name, first year, last year): a holiday on the same date every year.
FIXED = [
    (1, 1, "Restoration Day of the Independent Czech State; New Year's Day", FIRST_YEAR, LAST_YEAR),
    (5, 1, "Labour Day", FIRST_YEAR, LAST_YEAR),
    (5, 8, "Victory Day", 1992, LAST_YEAR),
    (5, 9, "Liberation Day", FIRST_YEAR, 1991),
    (7, 5, "Saints Cyril and Methodius Day", FIRST_YEAR, LAST_YEAR),
    (7, 6, "Jan Hus Day", FIRST_YEAR, LAST_YEAR),
    (9, 28, "St. Wenceslas Day (Czech Statehood Day)", 2000, LAST_YEAR),
    (10, 28, "Independent Czechoslovak State Day", FIRST_YEAR, LAST_YEAR),
    (11, 17, "Struggle for Freedom and Democracy Day", 2000, LAST_YEAR),
    (12, 24, "Christmas Eve", FIRST_YEAR, LAST_YEAR),
    (12, 25, "Christmas Day", FIRST_YEAR, LAST_YEAR),
    (12, 26, "St. Stephen's Day", FIRST_YEAR, LAST_YEAR),
]
GOOD_FRIDAY_SINCE = 2016


def easter_sunday(year: int) -> date:
    """Western (Gregorian) Easter Sunday: the anonymous Gregorian algorithm,
    as Meeus gives it. Integer arithmetic only, valid for every Gregorian year."""
    a = year % 19  # the year's place in the 19-year cycle of the Moon
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30  # days from 21 March to the Paschal full moon, roughly
    i, k = divmod(c, 4)
    weekday = (32 + 2 * e + 2 * i - h - k) % 7  # days from that full moon to the next Sunday
    m = (a + 11 * h + 22 * weekday) // 451  # the correction for the two exceptional cases
    month, day = divmod(h + weekday - 7 * m + 114, 31)
    return date(year, month, day + 1)


def check_year(year: int) -> None:
    if not FIRST_YEAR <= year <= LAST_YEAR:
        raise ValueError(f"a year from {FIRST_YEAR} to {LAST_YEAR}")


@cache
def holidays(year: int) -> tuple[Holiday, ...]:
    """The public holidays of a year, in date order. Cached: at most 111 years exist."""
    check_year(year)
    days = [Holiday(date(year, month, day), name) for month, day, name, first, last in FIXED if first <= year <= last]
    easter = easter_sunday(year)
    if year >= GOOD_FRIDAY_SINCE:
        days.append(Holiday(easter - timedelta(days=2), "Good Friday"))
    days.append(Holiday(easter + timedelta(days=1), "Easter Monday"))
    return tuple(sorted(days, key=lambda holiday: holiday.date))


def holiday_on(day: date) -> Holiday | None:
    return next((holiday for holiday in holidays(day.year) if holiday.date == day), None)


def is_working_day(day: date) -> bool:
    return day.weekday() < 5 and holiday_on(day) is None


def working_days(start: date, end: date) -> int:
    """Working days from `start` to `end`, both included. Whole weeks are
    counted at five days each, so the work does not grow with the range."""
    if end < start:
        raise ValueError("the range ends before it starts")
    total = (end - start).days + 1
    weeks, rest = divmod(total, 7)
    weekdays = weeks * 5 + sum(1 for i in range(rest) if (start + timedelta(days=i)).weekday() < 5)
    off = sum(
        1
        for year in range(start.year, end.year + 1)
        for holiday in holidays(year)
        if start <= holiday.date <= end and holiday.date.weekday() < 5
    )
    return weekdays - off
