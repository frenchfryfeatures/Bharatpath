"""discovery - data access

Masked search, access-window checks, reveal audit.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**Which candidates an employer can see at all is decided in one place: the
CTE below.** PRD 7.2 asks for high-severity integrity signals to suppress a
candidate "as a filter inside the discovery query, not a separate code
path". A separate filtering step is something the next
endpoint forgets to call; a CTE that every query is built on is not.
`test_discovery_suppression.py` fails the build if a query function here
stops using it.

The CTE reads `scores`, `integrity_checks` and `integrity_signals` directly
with SQL rather than going through those modules' services. That is a
deliberate exception to the usual cross-module rule, and it is the only way to
honour the one above: suppression has to be a join the planner can use an
index for, not a per-candidate round trip after the page is already built.
Masked search extends the same exception to `candidate_profiles`, for the
location, and for the same reason.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.discovery.models import SearchFilterOption

#: The candidates an employer may see, as a CTE named `visible_candidates`
#: with columns `(user_id, resume_version_id)`. Compose it with
#: `WITH {VISIBLE_CANDIDATES_CTE} SELECT ... FROM visible_candidates ...`.
#:
#: A candidate is visible only when all four hold:
#:
#: 1. **They have a score.** Their latest one decides which resume version
#:    is current.
#: 2. **Their account is active** and is a candidate account.
#: 3. **That version has been through the integrity rules.** Fail closed:
#:    integrity runs asynchronously after scoring, and without this condition a
#:    CV carrying injected instructions would be searchable until the check ran.
#:    Any rule version counts, so a rule bump does not empty the search.
#: 4. **They carry no HIGH signal that is OPEN or CONFIRMED.** Candidate-wide,
#:    not per version: uploading a clean CV must not wash away a signal a human
#:    has not yet looked at, or injecting and then re-uploading becomes a way
#:    to reach employers anyway. The predicate matches `ix_integrity_suppressing`
#:    character for character so the planner can use it.
VISIBLE_CANDIDATES_CTE: str = """
visible_candidates AS (
    SELECT latest.user_id, latest.resume_version_id
      FROM (
            SELECT DISTINCT ON (s.user_id) s.user_id, s.resume_version_id
              FROM scores s
             ORDER BY s.user_id, s.computed_at DESC, s.id DESC
           ) AS latest
      JOIN users u
        ON u.id = latest.user_id
       AND u.status = 'ACTIVE'
       AND u.pool = 'CANDIDATE'
     WHERE EXISTS (
             SELECT 1
               FROM integrity_checks c
              WHERE c.resume_version_id = latest.resume_version_id
           )
       AND NOT EXISTS (
             SELECT 1
               FROM integrity_signals g
              WHERE g.candidate_id = latest.user_id
                AND g.severity = 'HIGH' AND g.state IN ('OPEN', 'CONFIRMED')
           )
)
"""


async def visible_candidate_ids(
    session: AsyncSession, *, limit: int, after: uuid.UUID | None = None
) -> list[uuid.UUID]:
    """A page of visible candidate ids, keyset-paginated on the id.

    The foundation masked search builds on. It returns ids only:
    everything an employer is shown about a candidate is a separate, audited
    read (invariant 7-prime).
    """
    # S608 is a false positive in every query here: every string joined is a
    # module constant, and every value a caller supplies is a bind parameter.
    query = (
        "WITH "  # noqa: S608
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT user_id
          FROM visible_candidates
         WHERE CAST(:after AS uuid) IS NULL OR user_id > CAST(:after AS uuid)
         ORDER BY user_id
         LIMIT :limit
        """
    )
    result = await session.execute(
        text(query), {"after": str(after) if after is not None else None, "limit": limit}
    )
    return [row.user_id for row in result]


async def is_candidate_visible(session: AsyncSession, *, candidate_id: uuid.UUID) -> bool:
    """Whether one candidate passes the same rule as search.

    The reveal must answer this before showing a profile,
    because a candidate can become suppressed between appearing in a result
    page and being clicked. It uses the identical CTE so that "in the search
    results" and "openable" can never disagree.
    """
    query = (
        "WITH " + VISIBLE_CANDIDATES_CTE + " SELECT 1 FROM visible_candidates WHERE user_id = :cid"  # noqa: S608
    )
    result = await session.execute(text(query), {"cid": str(candidate_id)})
    return result.first() is not None


async def count_visible_at_or_above(session: AsyncSession, *, min_score: int) -> int:
    """How many visible candidates' current score is at least `min_score`.

    Exact, and therefore **never returned to a client as it is**: the jobs
    service coarsens it before it leaves the building (`jobs/domain.py`). Built
    on the same CTE as search, so a suppressed or unchecked candidate is not
    counted -- a count that included them would reveal that they exist.
    """
    query = (
        "WITH "  # noqa: S608 - see the note on visible_candidate_ids
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT count(*)
          FROM visible_candidates vc
          JOIN LATERAL (
                SELECT s.raw_value
                  FROM scores s
                 WHERE s.user_id = vc.user_id
                 ORDER BY s.computed_at DESC, s.id DESC
                 LIMIT 1
               ) AS current ON true
         WHERE current.raw_value >= :min_score
        """
    )
    return int(await session.scalar(text(query), {"min_score": min_score}) or 0)


def _contains(value: str) -> str:
    """An ILIKE pattern matching `value` literally, wildcards and all."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def search_candidates(
    session: AsyncSession,
    *,
    bands: list[str],
    skill_groups: list[tuple[str, ...]],
    badges: list[str],
    min_experience_months: int | None,
    state_code: str | None,
    city_spellings: list[str],
    query: str | None,
    after: tuple[int, uuid.UUID] | None,
    limit: int,
) -> list[Any]:
    """A page of masked search rows: stronger bands first, then by id.

    **Selects nothing a card may not show.** No score and no contact -- the
    search document does not hold them, and the profile is read for the name
    and location only. The row is not a `MaskedCandidate` yet; the service
    makes it one, and the schema drops whatever it cannot show.

    **Only the filters asked for are in the SQL.** `(:x IS NULL OR ...)` would
    be one statement for every search, and a generic plan for it can use none
    of the GIN indexes, because the planner must assume any predicate might be
    switched off. Composing the WHERE clause from constant fragments keeps
    every value a bind parameter and every index usable.

    **A skill group is one chosen skill and its catalogued spellings**, and
    every group must match: `&&` per group, served by the same GIN index as
    `@>`, and a group of one is exactly the old containment test. **Cities
    are any-of**: every spelling of every chosen city is one contains-match,
    ORed.
    """
    predicates: list[str] = []
    params: dict[str, Any] = {"limit": limit}
    if bands:
        predicates.append("d.band = ANY(CAST(:bands AS text[]))")
        params["bands"] = bands
    for index, group in enumerate(skill_groups):
        predicates.append(f"d.skill_keys && CAST(:skills_{index} AS text[])")
        params[f"skills_{index}"] = list(group)
    if badges:
        predicates.append("d.badges @> CAST(:badges AS text[])")
        params["badges"] = badges
    if min_experience_months is not None:
        predicates.append("d.experience_months >= :min_months")
        params["min_months"] = min_experience_months
    if state_code:
        predicates.append("p.state_code = :state_code")
        params["state_code"] = state_code
    if city_spellings:
        # `ix_candidate_profiles_city_trgm` serves each contains-match; the
        # ORs become a BitmapOr of them.
        terms = []
        for index, spelling in enumerate(city_spellings):
            terms.append(f"p.city ILIKE :city_{index} ESCAPE '\\'")
            params[f"city_{index}"] = _contains(spelling)
        predicates.append("(" + " OR ".join(terms) + ")")
    if query:
        predicates.append("d.search_vector @@ plainto_tsquery('simple', :query)")
        params["query"] = query
    if after is not None:
        predicates.append(
            "(d.band_rank < :after_rank"
            " OR (d.band_rank = :after_rank AND d.user_id > CAST(:after_id AS uuid)))"
        )
        params["after_rank"], params["after_id"] = after[0], str(after[1])

    sql = (
        "WITH "  # noqa: S608 - see the note on visible_candidate_ids
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT d.user_id, d.band, d.band_rank, d.experience_months, d.skills, d.badges,
               p.full_name, p.city, p.state_code
          FROM visible_candidates vc
          JOIN candidate_search_documents d
            ON d.user_id = vc.user_id
           AND d.resume_version_id = vc.resume_version_id
          LEFT JOIN candidate_profiles p
            ON p.user_id = vc.user_id
         WHERE """
        + (" AND ".join(predicates) if predicates else "true")
        + """
         ORDER BY d.band_rank DESC, d.user_id
         LIMIT :limit
        """
    )
    result = await session.execute(text(sql), params)
    return list(result)


# ---------------------------------------------------------------------------
# The reveal
# ---------------------------------------------------------------------------
async def revealed_candidate(session: AsyncSession, *, candidate_id: uuid.UUID) -> Any:
    """One visible candidate's contact details and card facts, or None.

    **A different method from search, on purpose** (invariant 7): this is the
    only query in the module that selects a phone number or an email address,
    and nothing reaches it except through the access window, the caps and the
    audit row in `service.open_candidate`.

    Built on the visibility CTE, so "in the search results" and "openable"
    cannot disagree, and a candidate suppressed between the two is a miss.
    It returns the score's id, never its value: the display score is applied
    where the response is built.
    """
    query = (
        "WITH "  # noqa: S608 - see the note on visible_candidate_ids
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT vc.user_id, vc.resume_version_id,
               COALESCE(NULLIF(p.career->'details'->>'phone', ''), u.phone) AS phone, u.email,
               d.score_id, d.band, d.experience_months, d.skills, d.badges,
               p.full_name, p.city, p.state_code
          FROM visible_candidates vc
          JOIN users u
            ON u.id = vc.user_id
          JOIN candidate_search_documents d
            ON d.user_id = vc.user_id
           AND d.resume_version_id = vc.resume_version_id
          LEFT JOIN candidate_profiles p
            ON p.user_id = vc.user_id
         WHERE vc.user_id = CAST(:cid AS uuid)
        """
    )
    result = await session.execute(text(query), {"cid": str(candidate_id)})
    return result.first()


# ---------------------------------------------------------------------------
# Applicants (2026-10-05)
# ---------------------------------------------------------------------------
#: An applicant as their employer sees them, minus contact: the columns the
#: pipeline list and the opened application share. **Only for a candidate who
#: applied to this tenant and is visible right now**: the join to
#: `applications` on the tenant is the first condition, the CTE the second.
#: A candidate a HIGH signal is hiding is a miss, and the caller shows the
#: application without the person.
_APPLICANT_COLUMNS = """
        a.id AS application_id, vc.user_id, vc.resume_version_id,
        d.band, d.experience_months, d.skills, d.badges,
        p.full_name, p.city, p.state_code
"""
_APPLICANT_JOINS = """
          FROM applications a
          JOIN visible_candidates vc
            ON vc.user_id = a.candidate_id
          JOIN candidate_search_documents d
            ON d.user_id = vc.user_id
           AND d.resume_version_id = vc.resume_version_id
          LEFT JOIN candidate_profiles p
            ON p.user_id = vc.user_id
"""


async def applicant_cards(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    application_ids: list[uuid.UUID],
    candidate_ids: list[uuid.UUID],
) -> list[Any]:
    """Name and card facts for a page of this tenant's applications. No phone,
    no email, no score id: a list names people, it does not reveal them.

    `candidate_ids` repeats what the applications hold so the predicate on
    `vc.user_id` reaches inside the CTE, which then reads a page of people
    rather than every score in the database."""
    query = (
        "WITH "
        + VISIBLE_CANDIDATES_CTE
        + " SELECT "
        + _APPLICANT_COLUMNS
        + _APPLICANT_JOINS
        + """
         WHERE a.tenant_id = CAST(:tenant AS uuid)
           AND a.id = ANY(CAST(:apps AS uuid[]))
           AND vc.user_id = ANY(CAST(:cids AS uuid[]))
        """
    )
    result = await session.execute(
        text(query),
        {
            "tenant": str(tenant_id),
            "apps": [str(a) for a in application_ids],
            "cids": [str(c) for c in candidate_ids],
        },
    )
    return list(result)


async def applicants_named(
    session: AsyncSession, *, tenant_id: uuid.UUID, name: str
) -> list[uuid.UUID]:
    """The candidates who applied to this tenant, are visible right now, and
    whose profile name contains `name`, ignoring case.

    **Through the CTE like every other applicant read**: a name search that
    matched a hidden candidate would return their application, and the row's
    `candidate: null` beside the name typed would say who it is."""
    # The CTE is a module constant; the name is a bind parameter.
    query = (
        "WITH "  # noqa: S608
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT DISTINCT a.candidate_id
          FROM applications a
          JOIN candidate_profiles p
            ON p.user_id = a.candidate_id
          JOIN visible_candidates vc
            ON vc.user_id = a.candidate_id
         WHERE a.tenant_id = CAST(:tenant AS uuid)
           AND p.full_name ILIKE :pattern ESCAPE '\\'
        """
    )
    result = await session.execute(
        text(query), {"tenant": str(tenant_id), "pattern": _contains(name)}
    )
    return [row[0] for row in result]


async def applicant_profile(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    application_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> Any:
    """One applicant with contact details and the score's id, or None. The
    reveal's columns, reached through an application instead of search."""
    query = (
        "WITH "
        + VISIBLE_CANDIDATES_CTE
        + " SELECT "
        + _APPLICANT_COLUMNS
        + ", u.phone, u.email, d.score_id"
        + _APPLICANT_JOINS
        + """
          JOIN users u
            ON u.id = vc.user_id
         WHERE a.tenant_id = CAST(:tenant AS uuid)
           AND a.id = CAST(:app AS uuid)
           AND vc.user_id = CAST(:cid AS uuid)
        """
    )
    result = await session.execute(
        text(query),
        {"tenant": str(tenant_id), "app": str(application_id), "cid": str(candidate_id)},
    )
    return result.first()


async def opened_and_visible(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID
) -> bool:
    """Visible under the discovery rule, **and opened by this organisation at
    least once** (2026-10-05). The shortlist asks both: a candidate it shows
    by name must have been revealed -- counted against the caps, audited --
    first, or shortlisting from a masked card would be a free reveal."""
    query = (
        "WITH "  # noqa: S608 - see the note on visible_candidate_ids
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT 1 FROM visible_candidates vc
         WHERE vc.user_id = CAST(:cid AS uuid)
           AND EXISTS (
                 SELECT 1 FROM candidate_view_events e
                  WHERE e.tenant_id = CAST(:tenant AS uuid) AND e.candidate_id = vc.user_id
               )
        """
    )
    result = await session.execute(
        text(query), {"cid": str(candidate_id), "tenant": str(tenant_id)}
    )
    return result.first() is not None


async def shortlisted_cards(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_ids: list[uuid.UUID]
) -> list[Any]:
    """Name and card facts for candidates this organisation has shortlisted,
    visible right now. The shortlist join keeps it to the tenant's own rows;
    the CTE keeps out anyone a HIGH signal is hiding."""
    query = (
        "WITH "  # noqa: S608 - see the note on visible_candidate_ids
        + VISIBLE_CANDIDATES_CTE
        + """
        SELECT DISTINCT ON (vc.user_id)
               vc.user_id, vc.resume_version_id,
               d.band, d.experience_months, d.skills, d.badges,
               p.full_name, p.city, p.state_code
          FROM visible_candidates vc
          JOIN employer_shortlists s
            ON s.candidate_id = vc.user_id
           AND s.tenant_id = CAST(:tenant AS uuid)
          JOIN candidate_search_documents d
            ON d.user_id = vc.user_id
           AND d.resume_version_id = vc.resume_version_id
          LEFT JOIN candidate_profiles p
            ON p.user_id = vc.user_id
         WHERE vc.user_id = ANY(CAST(:cids AS uuid[]))
         ORDER BY vc.user_id
        """
    )
    result = await session.execute(
        text(query), {"tenant": str(tenant_id), "cids": [str(c) for c in candidate_ids]}
    )
    return list(result)


async def record_view(
    session: AsyncSession, *, tenant_id: uuid.UUID, actor_id: uuid.UUID, candidate_id: uuid.UUID
) -> bool:
    """Write the view event, **only for a candidate who is visible right now**.

    The insert selects from the visibility CTE, so the row cannot name
    someone the reveal would not show. False means nothing was written, and
    the caller must treat the candidate as not found.
    """
    query = (
        "WITH "  # noqa: S608 - see the note on visible_candidate_ids
        + VISIBLE_CANDIDATES_CTE
        + """
        INSERT INTO candidate_view_events (tenant_id, actor_id, candidate_id)
        SELECT CAST(:tenant AS uuid), CAST(:actor AS uuid), vc.user_id
          FROM visible_candidates vc
         WHERE vc.user_id = CAST(:cid AS uuid)
        RETURNING id
        """
    )
    result = await session.execute(
        text(query),
        {"tenant": str(tenant_id), "actor": str(actor_id), "cid": str(candidate_id)},
    )
    return result.first() is not None


# The functions below read no candidate: configuration, a lock, the view log's
# own counts, and partition upkeep. `test_discovery_suppression.py` names each
# one and fails if any of them starts reading a candidate table.
async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def lock_tenant_views(session: AsyncSession, *, tenant_id: uuid.UUID) -> None:
    """Serialise one organisation's reveals for the rest of the transaction.

    The caps are a count followed by an insert. Without this, a script firing
    fifty requests at once reads the same count fifty times and every one of
    them fits under the cap. Per organisation, so one employer's burst never
    waits on another's.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"discovery.views:{tenant_id}"},
    )


async def revealed_counts(
    session: AsyncSession, *, tenant_id: uuid.UUID, since: datetime
) -> tuple[int, int]:
    """Distinct candidates this organisation has opened: ever, and since `since`.

    The organisation's own view log, counted for its dashboard. Ids are
    counted, never returned.
    """
    query = text(
        """
        SELECT count(DISTINCT e.candidate_id),
               count(DISTINCT e.candidate_id) FILTER (WHERE e.viewed_at >= :since)
          FROM candidate_view_events e
         WHERE e.tenant_id = CAST(:tenant AS uuid)
        """
    )
    row = (await session.execute(query, {"tenant": str(tenant_id), "since": since})).one()
    return int(row[0]), int(row[1])


async def view_counts(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    candidate_id: uuid.UUID,
    velocity_minutes: int,
) -> Any:
    """Distinct candidates opened by this organisation and this person, from the log.

    One rolling day, which `ix_view_events_tenant_time` serves and partition
    pruning keeps to one or two months. Rolling rather than a calendar day, so
    a cap cannot be doubled by straddling midnight.
    """
    query = text(
        """
        SELECT
          count(DISTINCT e.candidate_id)
            FILTER (WHERE e.viewed_at > now() - interval '1 hour') AS tenant_last_hour,
          count(DISTINCT e.candidate_id) AS tenant_last_day,
          count(DISTINCT e.candidate_id)
            FILTER (WHERE e.actor_id = CAST(:actor AS uuid)
                      AND e.viewed_at > now() - make_interval(mins => CAST(:minutes AS integer)))
            AS actor_in_window,
          coalesce(bool_or(e.candidate_id = CAST(:cid AS uuid)
                           AND e.viewed_at > now() - interval '1 hour'), false)
            AS seen_by_tenant_last_hour,
          coalesce(bool_or(e.candidate_id = CAST(:cid AS uuid)), false)
            AS seen_by_tenant_last_day,
          coalesce(bool_or(e.candidate_id = CAST(:cid AS uuid)
                           AND e.actor_id = CAST(:actor AS uuid)
                           AND e.viewed_at > now()
                               - make_interval(mins => CAST(:minutes AS integer))),
                   false)
            AS seen_by_actor_in_window
          FROM candidate_view_events e
         WHERE e.tenant_id = CAST(:tenant AS uuid)
           AND e.viewed_at > now() - interval '24 hours'
        """
    )
    result = await session.execute(
        query,
        {
            "tenant": str(tenant_id),
            "actor": str(actor_id),
            "cid": str(candidate_id),
            "minutes": velocity_minutes,
        },
    )
    return result.one()


async def ensure_view_partitions(session: AsyncSession, *, first_month: date, months: int) -> int:
    """Create any missing monthly partitions of the view log. Returns how many."""
    created = await session.scalar(
        text("SELECT ensure_candidate_view_partitions(:first_month, :months)"),
        {"first_month": first_month, "months": months},
    )
    return int(created or 0)


# ---------------------------------------------------------------------------
# Who viewed my profile (2026-10-02)
# ---------------------------------------------------------------------------
async def profile_views(
    session: AsyncSession, *, after: tuple[datetime, uuid.UUID] | None, limit: int
) -> list[Any]:
    """Organisations that opened the bound candidate's profile, latest first.

    Through `candidate_profile_views()` (migration 0009), which answers only
    for `current_candidate_id()` -- there is no candidate id to pass, so the
    caller must have bound `app.user_id`. It returns the organisation's name
    and its latest open, never who in it looked. Named in `READS_NO_CANDIDATE`:
    the visibility CTE decides what an employer may see, and this is the
    candidate reading their own log.
    """
    result = await session.execute(
        text(
            "SELECT tenant_id, employer_name, last_viewed_at FROM candidate_profile_views("
            "CAST(:before_at AS timestamptz), CAST(:before_tenant AS uuid), :limit)"
        ),
        {
            "before_at": after[0] if after is not None else None,
            "before_tenant": str(after[1]) if after is not None else None,
            "limit": limit,
        },
    )
    return list(result)


# ---------------------------------------------------------------------------
# Search filter options (2026-09-24)
# ---------------------------------------------------------------------------
# The catalogue staff curate. None of these reads a candidate, and each is
# named in `READS_NO_CANDIDATE`.
_OPTION_CONTAINS = (
    "(key LIKE :contains ESCAPE '\\'"
    " OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a LIKE :contains ESCAPE '\\'))"
)


def _prefix(value: str) -> str:
    """A LIKE pattern for values starting with `value`, wildcards and all."""
    return _contains(value)[1:]


async def featured_filter_options(
    session: AsyncSession, *, kind: str, limit: int
) -> list[SearchFilterOption]:
    result = await session.execute(
        select(SearchFilterOption)
        .where(
            SearchFilterOption.kind == kind,
            SearchFilterOption.featured,
            SearchFilterOption.active,
        )
        .order_by(SearchFilterOption.sort_order, SearchFilterOption.label)
        .limit(limit)
    )
    return list(result.scalars())


async def suggest_filter_options(
    session: AsyncSession, *, kind: str, query: str, state_code: str | None, limit: int
) -> list[SearchFilterOption]:
    """Active options whose key or an alias contains `query` (an `option_key`
    already). An exact key first, then a key starting with it, then an alias
    starting with it, then anything containing it."""
    state = " AND state_code = :state" if state_code else ""
    sql = (
        "SELECT * FROM search_filter_options"  # noqa: S608 - constant fragments only
        " WHERE kind = :kind AND active AND "
        + _OPTION_CONTAINS
        + state
        + """
         ORDER BY CASE
                    WHEN key = :exact THEN 0
                    WHEN key LIKE :prefix ESCAPE '\\' THEN 1
                    WHEN EXISTS (SELECT 1 FROM unnest(aliases) a
                                  WHERE a LIKE :prefix ESCAPE '\\') THEN 2
                    ELSE 3
                  END,
                  featured DESC, sort_order, label
         LIMIT :limit
        """
    )
    params: dict[str, Any] = {
        "kind": kind,
        "exact": query,
        "prefix": _prefix(query),
        "contains": _contains(query),
        "limit": limit,
    }
    if state_code:
        params["state"] = state_code
    result = await session.execute(select(SearchFilterOption).from_statement(text(sql)), params)
    return list(result.scalars())


async def options_naming(
    session: AsyncSession, *, kind: str, keys: list[str]
) -> list[SearchFilterOption]:
    """Active options whose key or an alias is one of `keys`: what a search
    expands a chosen value into."""
    if not keys:
        return []
    result = await session.execute(
        select(SearchFilterOption).where(
            SearchFilterOption.kind == kind,
            SearchFilterOption.active,
            SearchFilterOption.key.in_(keys) | SearchFilterOption.aliases.overlap(keys),
        )
    )
    return list(result.scalars())


async def options_claiming(
    session: AsyncSession, *, kind: str, keys: list[str], except_id: uuid.UUID | None = None
) -> list[SearchFilterOption]:
    """Every option, active or not, already holding one of `keys` as its key
    or an alias. A switched-off option keeps its spellings, so switching it
    back on never finds them taken."""
    if not keys:
        return []
    statement = select(SearchFilterOption).where(
        SearchFilterOption.kind == kind,
        SearchFilterOption.key.in_(keys) | SearchFilterOption.aliases.overlap(keys),
    )
    if except_id is not None:
        statement = statement.where(SearchFilterOption.id != except_id)
    return list((await session.execute(statement)).scalars())


async def lock_filter_catalogue(session: AsyncSession, *, kind: str) -> None:
    """Serialise catalogue writes of one kind, so two staff adding the same
    alias to different options cannot both pass the clash check."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"discovery.filter_options:{kind}"},
    )


async def get_filter_option(
    session: AsyncSession, *, option_id: uuid.UUID
) -> SearchFilterOption | None:
    return await session.get(SearchFilterOption, option_id)


async def list_filter_options(
    session: AsyncSession,
    *,
    kind: str | None,
    query: str | None,
    include_inactive: bool,
    after: tuple[str, str] | None,
    limit: int,
) -> list[SearchFilterOption]:
    """The console's list, by kind then key: a stable keyset."""
    statement = select(SearchFilterOption)
    if kind is not None:
        statement = statement.where(SearchFilterOption.kind == kind)
    if not include_inactive:
        statement = statement.where(SearchFilterOption.active)
    if query:
        statement = statement.where(text(_OPTION_CONTAINS).bindparams(contains=_contains(query)))
    if after is not None:
        statement = statement.where(
            (SearchFilterOption.kind > after[0])
            | ((SearchFilterOption.kind == after[0]) & (SearchFilterOption.key > after[1]))
        )
    result = await session.execute(
        statement.order_by(SearchFilterOption.kind, SearchFilterOption.key).limit(limit)
    )
    return list(result.scalars())


async def insert_filter_options(session: AsyncSession, options: list[SearchFilterOption]) -> None:
    session.add_all(options)
    await session.flush()
    for option in options:
        await session.refresh(option)


async def save_filter_option(session: AsyncSession, option: SearchFilterOption) -> None:
    """Write the changes the service made to a loaded option."""
    await session.flush()
    await session.refresh(option)
