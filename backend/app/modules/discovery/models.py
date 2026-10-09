"""discovery - SQLAlchemy ORM models.

Masked search, access-window checks, reveal audit.

**There is no `unlocks` table and no `wallet_ledger`.** The client replaced
per-candidate unlocking on 2026-08-27: an employer pays once per period and
"every student is unlocked automatically ... they can view anyone in the whole
database." The subscription IS the entitlement, so there is nothing to bill
per candidate, nothing to decrement, and no unlock row to make unique.

**That moved the risk rather than removing it**, which is what the view-event
table is for. Blanket access destroys the natural one-row-per-unlock audit
trail, but PRD rule 9 still requires every reveal of private data to be logged
- so the audit moved to the read. Every candidate profile an employer opens
writes a row there, in the same transaction as the reveal.

That will be the fastest-growing table in the schema. It is partitioned by
month for exactly that reason: `postgresql_partition_by` below makes the table
a partitioned parent, and the baseline adds the monthly partitions, a DEFAULT
partition and the function that creates the next ones
(`_create_view_event_partitions`).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey
from app.modules.discovery.domain import (
    FILTER_KINDS,
    MAX_CITY_LABEL_LENGTH,
    MAX_OPTION_ALIASES,
    MAX_SORT_ORDER,
)


class CandidateViewEvent(Base):
    """The audit spine for invariant 7-prime.

    A bigserial key rather than a UUID: this is an append-only firehose where
    insert throughput matters more than opacity, and nothing external ever
    references a row by id.

    **The key is `(id, viewed_at)`**, not `id` alone. Postgres requires every
    unique constraint on a partitioned table to include the partition key, so
    a primary key on `id` alone cannot exist here. `id` still comes from one
    sequence and is unique in practice.

    One row per profile opened, re-opens included: this is the audit spine,
    not a set of candidates. The view caps count *distinct* candidates in it.
    """

    __tablename__ = "candidate_view_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), primary_key=True
    )

    __table_args__ = (
        # Drives the per-tenant hourly and daily view caps, which are the
        # main mitigation for the bulk-extraction risk. This index is what
        # keeps that check cheap enough to run on every reveal.
        Index("ix_view_events_tenant_time", "tenant_id", "viewed_at"),
        Index("ix_view_events_actor_time", "actor_id", "viewed_at"),
        Index("ix_view_events_candidate", "candidate_id"),
        {"postgresql_partition_by": "RANGE (viewed_at)"},
    )


class CandidateSearchDocument(Base):
    """What masked search filters on: one row per candidate, from their latest score.

    **Written by the database and nothing else.** An `AFTER INSERT` trigger on
    `scores` (`project_candidate_search_document` in the baseline) derives it
    from the row just written, and the app role holds no INSERT, UPDATE or
    DELETE here. So the document can never disagree with the score it came
    from, there is no event to miss and no task to fall behind, and no code
    path can put something on a card the score does not support.

    **It decides nothing about visibility.** Search joins it through
    `VISIBLE_CANDIDATES_CTE` on `(user_id, resume_version_id)`: a suppressed or
    unchecked candidate still has a document and still never appears, and a
    document left behind by an older version matches nothing.

    **It holds no score.** `band` is derived from the raw value by bands the
    trigger is generated from (`scoring.domain.BANDS`); the value itself is not
    copied. Nor is anything a CV says about who someone is: skills, summed
    experience and add-on badges, and that is all.

    **Indexed deliberately**, because this is the query that gets slow first:
    GIN over the skill keys, badges and the text vector, and
    the band ordering as a btree the keyset pagination walks.
    """

    __tablename__ = "candidate_search_documents"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    score_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("scores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    resume_version_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="CASCADE"), nullable=False
    )
    #: The score's own `computed_at`, so a late-arriving older score cannot
    #: overwrite a newer document.
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    band: Mapped[str] = mapped_column(String(16), nullable=False)
    #: The band's position, lowest first. Ordering by it shows the stronger
    #: bands first without ordering by -- and so leaking -- the score.
    band_rank: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: Summed from the extraction's roles exactly as `scoring.domain.
    #: features_from_extraction` sums them; an integration test holds the two
    #: together.
    experience_months: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Distinct canonical skills as extracted, first spelling wins, contact-like
    #: text removed.
    skills: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    #: The same skills, trimmed and lower-cased: what a skill filter matches.
    skill_keys: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    badges: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    #: `to_tsvector('simple', skills)`. The `simple` configuration, not
    #: `english`: skill names are proper nouns and acronyms, and stemming
    #: "SAP" or "Kaizen" helps nobody.
    search_vector: Mapped[str] = mapped_column(TSVECTOR, nullable=False)

    __table_args__ = (
        CheckConstraint("band_rank >= 0", name="ck_search_documents_band_rank"),
        CheckConstraint("experience_months >= 0", name="ck_search_documents_experience"),
        Index("ix_search_documents_skill_keys", "skill_keys", postgresql_using="gin"),
        Index("ix_search_documents_badges", "badges", postgresql_using="gin"),
        Index("ix_search_documents_text", "search_vector", postgresql_using="gin"),
        Index("ix_search_documents_experience", "experience_months"),
        Index("ix_search_documents_resume_version", "resume_version_id"),
    )


# `ORDER BY band_rank DESC, user_id` -- mixed directions, so the index has to
# say so or the planner cannot walk it for a keyset page.
Index(
    "ix_search_documents_order",
    CandidateSearchDocument.band_rank.desc(),
    CandidateSearchDocument.user_id,
)


class SearchFilterOption(Base, UUIDPrimaryKey, Timestamps):
    """A skill or a city the employer's filter panel offers (2026-09-24).

    **Curated by staff, never drawn from the pool** -- see `domain` for why.
    Search takes any text; an option adds the spellings (`aliases`) that
    choosing it also searches, and `featured` puts it on the panel before
    anything is typed.

    **Switched off, never deleted.** The app role holds no DELETE: a saved
    search or a shared link naming an option keeps working as plain text, and
    `updated_by` says who changed it last. Every change also writes an audit
    row.

    `key` and every alias are lower-cased and whitespace-collapsed
    (`domain.option_key`). One spelling belongs to one option per kind; the
    unique constraint holds the key and the service holds the aliases, under
    a per-kind advisory lock.
    """

    __tablename__ = "search_filter_options"

    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    label: Mapped[str] = mapped_column(String(MAX_CITY_LABEL_LENGTH), nullable=False)
    key: Mapped[str] = mapped_column(String(MAX_CITY_LABEL_LENGTH), nullable=False)
    aliases: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'::text[]")
    )
    state_code: Mapped[str | None] = mapped_column(String(2))
    featured: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    #: NULL for a row the seed script wrote.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )

    __table_args__ = (
        UniqueConstraint("kind", "key", name="uq_search_filter_options_kind_key"),
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in FILTER_KINDS) + ")",
            name="ck_search_filter_options_kind",
        ),
        CheckConstraint(
            "key = lower(key) AND key <> '' AND char_length(label) > 0",
            name="ck_search_filter_options_key_normalised",
        ),
        CheckConstraint(
            "(kind = 'CITY') = (state_code IS NOT NULL)",
            name="ck_search_filter_options_state_only_for_cities",
        ),
        CheckConstraint(
            f"cardinality(aliases) <= {MAX_OPTION_ALIASES} AND NOT (key = ANY(aliases))",
            name="ck_search_filter_options_aliases",
        ),
        CheckConstraint(
            f"sort_order BETWEEN 0 AND {MAX_SORT_ORDER}",
            name="ck_search_filter_options_sort_order",
        ),
        Index("ix_search_filter_options_aliases", "aliases", postgresql_using="gin"),
        Index(
            "ix_search_filter_options_featured",
            "kind",
            "sort_order",
            postgresql_where=text("featured AND active"),
        ),
    )
