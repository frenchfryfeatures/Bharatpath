"""discovery - pure domain logic

Masked search, access-window checks, reveal audit.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**What a masked card may say** (SRS 1.14.1, 2.9.6): a band,
roughly how much experience, which skills, where, and which add-ons were
completed, and since 2026-10-06 the name the candidate gave. Never a phone
number, an email or the score itself. Most of that is kept out by the card
having nowhere to put it (`schemas.MaskedCandidate`);
the rules below cover the one gap a schema cannot close on its own -- free
text that came from a CV.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, fields
from typing import Final, Literal

from app.modules.candidate.domain import STATE_CODES, normalise_city

#: `scores.contributing_events[].kind` -> the badge an employer sees.
#:
#: A badge says an add-on was completed and folded into the score. It never
#: says what was answered, how an interview went, or how many points it earned
#: -- "badges only, never raw add-on content". The kinds are the ones
#: `scoring.service.replay` reads, and an invariant test holds the two together.
#:
#: The questionnaire has no badge, deliberately: a badge here means an add-on
#: folded into the score, and the questionnaire is worth nothing. Its answers
#: reaching employers would be a filter decision, not a badge.
BADGE_FOR_ADDON_KIND: Final[dict[str, str]] = {
    "course": "COURSE_COMPLETED",
    "interview": "MOCK_INTERVIEW_COMPLETED",
}

#: Anything that could be an email address or a phone number.
#:
#: Skills come from the Layer 1 extraction of a CV, and a CV is written by the
#: person it describes -- so "Skills: call 98765 43210" is a way to put a phone
#: number on a masked card. A skill matching this is dropped from the search
#: document (so it cannot be searched for either) and again at the card.
#:
#: One pattern, deliberately written in the regex dialect Python and Postgres
#: share, because the migration's trigger applies the same text with `~`.
#: A run of eight or more digit-ish characters is a phone number; "ISO
#: 9001:2015", "IEC 61131-3" and "Python 3.12" are not.
CONTACT_LIKE_PATTERN: Final = r"@|[0-9][0-9 ()+.-]{6,}[0-9]"
_CONTACT_LIKE: Final = re.compile(CONTACT_LIKE_PATTERN)

MAX_SKILL_LENGTH: Final = 80
#: Skills shown on one card. The search document keeps all of them for
#: filtering; a card is a summary, not the CV.
MAX_CARD_SKILLS: Final = 20
#: Skills one search may require. Each is an array-containment term on a GIN
#: index, so this bounds the query rather than the index.
MAX_SKILL_FILTERS: Final = 5
MAX_EXPERIENCE_YEARS: Final = 60

#: How far back a candidate's "who viewed my profile" list reaches
#: (2026-10-02). Ours, not the client's. Frozen as SQL in migration
#: `0009_candidate_profile_views`, and a test holds the two equal; a new
#: period is a new migration.
PROFILE_VIEWS_LOOKBACK_DAYS: Final = 90


def looks_like_contact(value: str) -> bool:
    return _CONTACT_LIKE.search(value) is not None


def skill_key(value: str) -> str:
    """How a skill is matched: trimmed and case-folded, as the trigger stores it."""
    return value.strip().lower()


def displayable_skills(skills: Iterable[object]) -> list[str]:
    """The skills a card may show, in order: trimmed, bounded, never contact data.

    Drops rather than raises. This runs while a response is being built, and a
    CV carrying one odd skill must not turn a whole search page into a 500.
    """
    shown: list[str] = []
    for skill in skills:
        if not isinstance(skill, str):
            continue
        name = skill.strip()
        if not name or len(name) > MAX_SKILL_LENGTH or looks_like_contact(name):
            continue
        shown.append(name)
        if len(shown) == MAX_CARD_SKILLS:
            break
    return shown


def experience_years(months: int) -> int:
    """Whole years, rounded down. The filter asks for "at least N years", and
    rounding up would admit someone eleven months short of it."""
    return min(max(0, months) // 12, MAX_EXPERIENCE_YEARS)


# ---------------------------------------------------------------------------
# Abuse controls
# ---------------------------------------------------------------------------
#
# One payment buys the whole candidate database (R14), and KYB approves itself
# (R15), so **the throttle is the protection**. These are mitigation, not a
# fix -- the fix is verifying who pays, and the client has switched that off
# (plan.md R14, blockers B7).


@dataclass(frozen=True, slots=True)
class DiscoveryLimits:
    """Every number that throttles an employer's reach into the pool.

    Loaded from `config_values` key `discovery.limits`; these defaults apply
    only when no row exists. We proposed them and the client accepted them as
    the defaults on 2026-09-15: generous for a recruiter screening by hand,
    and a ceiling far below the pool for anyone walking it.
    """

    #: Distinct candidates one organisation may open per rolling hour.
    views_per_hour: int = 60
    #: Distinct candidates one organisation may open per rolling 24 hours.
    views_per_day: int = 300
    #: Profile requests per person per minute, re-opens included. A burst
    #: limit in Redis, ahead of the database.
    reveals_per_minute: int = 20
    #: Masked search pages per organisation per hour.
    search_pages_per_hour: int = 300
    #: One person opening this many distinct candidates inside this many
    #: minutes is flagged for a human.
    velocity_window_minutes: int = 10
    velocity_views: int = 40


DEFAULT_LIMITS: Final = DiscoveryLimits()

#: Above this, a limit is a typo rather than a decision.
MAX_LIMIT_VALUE: Final = 100_000
#: The view counts read one rolling day of the log, so a velocity window
#: longer than that would silently count less than it says.
MAX_VELOCITY_WINDOW_MINUTES: Final = 24 * 60


class DiscoveryLimitsError(ValueError):
    """A `discovery.limits` document that cannot be applied."""


def limits_from_config(value: Mapping[str, object]) -> DiscoveryLimits:
    """Parse a `config_values` document. **Strict**: anything doubtful raises.

    Any key may be omitted to keep its default. An unknown key raises, because
    the likeliest cause is a misspelling, and ignoring `views_per_dya` would
    leave the default live while the row looked applied -- for the one control
    standing between a single payment and the whole pool.
    """
    names = {f.name for f in fields(DiscoveryLimits)}
    unknown = set(value) - names
    if unknown:
        raise DiscoveryLimitsError(f"unknown discovery limit keys: {sorted(unknown)}")
    parsed: dict[str, int] = {}
    for name in names:
        raw = value.get(name, getattr(DEFAULT_LIMITS, name))
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise DiscoveryLimitsError(f"{name} must be an integer")
        if not 1 <= raw <= MAX_LIMIT_VALUE:
            raise DiscoveryLimitsError(f"{name} must be between 1 and {MAX_LIMIT_VALUE}")
        parsed[name] = raw
    limits = DiscoveryLimits(**parsed)
    if limits.views_per_hour > limits.views_per_day:
        raise DiscoveryLimitsError("views_per_hour cannot exceed views_per_day")
    if limits.velocity_window_minutes > MAX_VELOCITY_WINDOW_MINUTES:
        raise DiscoveryLimitsError(
            f"velocity_window_minutes cannot exceed {MAX_VELOCITY_WINDOW_MINUTES}"
        )
    return limits


@dataclass(frozen=True, slots=True)
class ViewCounts:
    """What the view log says, read before this view is recorded.

    Counts are of **distinct candidates**, and a candidate already opened in a
    window costs nothing to open again: re-reading a profile while writing to
    someone is not extraction, and charging for it would push recruiters to
    copy details out of the product instead.
    """

    tenant_last_hour: int
    tenant_last_day: int
    #: Distinct candidates this person opened inside the velocity window.
    actor_in_window: int
    seen_by_tenant_last_hour: bool
    seen_by_tenant_last_day: bool
    seen_by_actor_in_window: bool


CapWindow = Literal["HOURLY", "DAILY"]


def cap_refusal(limits: DiscoveryLimits, counts: ViewCounts) -> CapWindow | None:
    """Which cap refuses this view, if any. The daily cap is reported first:
    it is the longer wait, and the one worth telling a person about."""
    if not counts.seen_by_tenant_last_day and counts.tenant_last_day >= limits.views_per_day:
        return "DAILY"
    if not counts.seen_by_tenant_last_hour and counts.tenant_last_hour >= limits.views_per_hour:
        return "HOURLY"
    return None


AnomalyKind = Literal["ACTOR_VELOCITY", "DAILY_CAP_REACHED"]


def anomalies(limits: DiscoveryLimits, counts: ViewCounts) -> tuple[AnomalyKind, ...]:
    """What an allowed view should alert on.

    **Crossings, not levels.** Each fires on the one view that reaches its
    threshold, so a person who keeps going raises one alert rather than one
    per profile. The caller holds a per-organisation lock while counting, so
    two concurrent views cannot both be "the one".
    """
    found: list[AnomalyKind] = []
    if not counts.seen_by_actor_in_window and counts.actor_in_window + 1 == limits.velocity_views:
        found.append("ACTOR_VELOCITY")
    if not counts.seen_by_tenant_last_day and counts.tenant_last_day + 1 == limits.views_per_day:
        found.append("DAILY_CAP_REACHED")
    return tuple(found)


# ---------------------------------------------------------------------------
# Search filter options (2026-09-24)
# ---------------------------------------------------------------------------
#
# The skills and cities an employer picks from when filtering, curated by
# staff in `search_filter_options`. **A suggestion, never a restriction**:
# search still takes any text, so an employer can filter on a skill nobody
# has catalogued. What the catalogue adds is spellings. Skills are whatever
# Layer 1 wrote and cities are whatever the candidate typed, so "Forklift
# certified" and "forklift operation", or "Bengaluru" and "Bangalore", never
# meet by exact match. An option's aliases are searched with it.
#
# **The catalogue is ours, not drawn from the pool.** A suggestion taken from
# candidates' own skills would tell an employer that somebody holds a rare
# one -- the same leak `Page.total` is withheld to prevent. For the same
# reason no option ever carries a count.

FilterKind = Literal["SKILL", "CITY"]
FILTER_KINDS: Final[tuple[FilterKind, ...]] = ("SKILL", "CITY")

#: Cities one search may name. Any of them matches (a location is where
#: someone is, so "Pune or Nashik"); skills, by contrast, must all match.
MAX_CITY_FILTERS: Final = 5
#: Aliases one option may carry. Each becomes a term of the search, so this
#: bounds the query: five cities of eleven spellings is 55 ILIKEs at most.
MAX_OPTION_ALIASES: Final = 10
MAX_CITY_LABEL_LENGTH: Final = 100
#: Typeahead answers, and the featured options the panel shows unasked.
MAX_SUGGESTIONS: Final = 20
MAX_FEATURED_OPTIONS: Final = 40
#: What an option's `sort_order` may be. Lower is shown first.
MAX_SORT_ORDER: Final = 10_000

#: "N+ years" steps the panel offers. The search takes any whole number.
EXPERIENCE_STEPS: Final[tuple[int, ...]] = (1, 3, 5, 10)

#: Display names for `scoring.domain.BANDS`, which this module may not
#: import. An invariant test holds the keys equal to the band labels. No
#: score range is given: employers see the band, never the number (R4).
BAND_LABELS: Final[dict[str, str]] = {
    "ENTRY": "Entry",
    "DEVELOPING": "Developing",
    "SOLID": "Solid",
    "STRONG": "Strong",
}
BADGE_LABELS: Final[dict[str, str]] = {
    "COURSE_COMPLETED": "Course completed",
    "MOCK_INTERVIEW_COMPLETED": "Mock interview completed",
}


class FilterOptionError(ValueError):
    """An option, alias or filter value that cannot be catalogued or searched."""


@dataclass(frozen=True, slots=True)
class FilterOptionTerms:
    """One option, normalised: what is stored and what it matches."""

    kind: FilterKind
    label: str
    #: `label` as matched -- trimmed and lower-cased, as the search
    #: document stores skill keys.
    key: str
    #: Other spellings, in the same form as `key`, never including it.
    aliases: tuple[str, ...]
    state_code: str | None

    @property
    def keys(self) -> tuple[str, ...]:
        return (self.key, *self.aliases)


def option_key(value: str) -> str:
    """How any option or filter value is matched: whitespace collapsed,
    lower-cased. The same key `skill_key` gives a skill once it is trimmed."""
    return " ".join(value.split()).lower()


def normalise_option_text(kind: FilterKind, value: str) -> str:
    """A label or alias as it is shown. Raises `FilterOptionError`.

    A skill is any text a card could show. A city follows the candidate's own
    city rule -- letters, spaces and `. ' -` -- because a city option exists to
    match what candidates type, and no candidate can type anything else.
    """
    if kind == "CITY":
        try:
            return normalise_city(value)
        except ValueError as exc:
            raise FilterOptionError(str(exc)) from exc
    text = " ".join(value.split())
    if not text:
        raise FilterOptionError("a skill is empty")
    if len(text) > MAX_SKILL_LENGTH:
        raise FilterOptionError(f"a skill is longer than {MAX_SKILL_LENGTH} characters")
    if looks_like_contact(text):
        raise FilterOptionError("a skill cannot look like a phone number or an email address")
    return text


def filter_option_terms(
    kind: FilterKind,
    *,
    label: str,
    aliases: Iterable[str] = (),
    state_code: str | None = None,
) -> FilterOptionTerms:
    """Validate one option. Raises `FilterOptionError` with a reason a person
    can act on.

    A city must name its state: the panel shows "Aurangabad, MH", and without
    it two Aurangabads are indistinguishable. A skill has none. Aliases that
    repeat the label or each other are dropped rather than refused -- typing
    "Pune" as an alias of Pune is not a mistake worth a 422.
    """
    if kind not in FILTER_KINDS:
        raise FilterOptionError(f"kind must be one of {list(FILTER_KINDS)}")
    shown = normalise_option_text(kind, label)
    key = option_key(shown)
    if kind == "CITY":
        if state_code is None:
            raise FilterOptionError("a city needs its state_code")
        if state_code not in STATE_CODES:
            raise FilterOptionError(f"{state_code!r} is not a state or union territory code")
    elif state_code is not None:
        raise FilterOptionError("only a city has a state_code")

    seen = {key}
    kept: list[str] = []
    for alias in aliases:
        alias_key = option_key(normalise_option_text(kind, alias))
        if alias_key not in seen:
            seen.add(alias_key)
            kept.append(alias_key)
    if len(kept) > MAX_OPTION_ALIASES:
        raise FilterOptionError(f"an option may have at most {MAX_OPTION_ALIASES} aliases")
    return FilterOptionTerms(kind, shown, key, tuple(kept), state_code)


def clashing_keys(terms: Iterable[FilterOptionTerms]) -> list[str]:
    """Keys that more than one of `terms` claims, as a key or an alias.

    One spelling must lead to one option, or choosing "Bombay" would search a
    different set of cities depending on which option happened to be read
    first. Checked across a bulk import here, and against the stored
    catalogue by the service.
    """
    owners: dict[tuple[str, str], int] = {}
    clashes: set[str] = set()
    for index, term in enumerate(terms):
        for key in term.keys:
            claimed = owners.setdefault((term.kind, key), index)
            if claimed != index:
                clashes.add(key)
    return sorted(clashes)


def filter_groups(
    values: Iterable[str], options: Iterable[tuple[str, Iterable[str]]]
) -> list[tuple[str, ...]]:
    """Each filter value, as every spelling it should match.

    `options` is `(key, aliases)` for the catalogued options any value named.
    A value that is an option's key or one of its aliases becomes that
    option's whole group; any other value is itself alone, so custom text
    still searches exactly as it did before the catalogue existed. Values
    naming the same option collapse into one group.
    """
    group_of: dict[str, tuple[str, ...]] = {}
    for key, aliases in options:
        group = (key, *(a for a in aliases if a != key))
        for spelling in group:
            group_of.setdefault(spelling, group)
    groups: list[tuple[str, ...]] = []
    for value in values:
        # Custom text keeps the search document's own form (`skill_key`,
        # which trims but does not collapse inner spaces), so it matches
        # exactly what it matched before the catalogue existed.
        group = group_of.get(option_key(value), (skill_key(value),))
        if group not in groups:
            groups.append(group)
    return groups
