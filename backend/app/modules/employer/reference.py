"""Employer type and industry vocabularies.

Confirmed by the client, 2026-09-11.

**Why these are closed lists and not a free-text box.** Candidates filter on
them. Free text produces "IT", "I.T.", "Information Technology" and "it" as
four different industries, and the filter silently returns a quarter of the
matches it should. Once that data is in the database it is close to
unrecoverable -- you cannot reliably re-map free text a year later.

**Data, not logic.** Adding an industry is a one-line change here plus a
migration of nothing: the column is a string, the list is the vocabulary, and
`is_valid_industry` is the only gate. The client can extend it without anyone
touching the scoring, matching or KYB code.

Codes are stable and stored; labels are display text and may be translated.
**Never rename a code** -- rows already carry it. Retire it with `active=False`
instead, so existing employers keep a valid value while nobody new can pick it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class Term:
    code: str
    label: str
    active: bool = True


#: What kind of organisation. Deliberately short: a long list makes the field
#: a guess rather than a fact, and nobody filters on twenty options.
EMPLOYER_TYPES: Final[tuple[Term, ...]] = (
    Term("STARTUP", "Startup"),
    Term("PRIVATE_LIMITED", "Private company"),
    Term("PUBLIC_LIMITED", "Public limited company"),
    Term("MNC", "Multinational corporation"),
    Term("GOVERNMENT", "Government or public sector"),
    Term("NGO", "NGO or non-profit"),
    Term("STAFFING_AGENCY", "Staffing or recruitment agency"),
    Term("EDUCATIONAL_INSTITUTION", "College or university"),
    Term("PROPRIETORSHIP", "Proprietorship or partnership"),
)

#: Sectors. Chosen to cover where hiring volume actually is in India rather
#: than to be exhaustive -- an employer who cannot find themselves here is a
#: signal to add one, not a reason to allow free text.
INDUSTRIES: Final[tuple[Term, ...]] = (
    Term("IT_SOFTWARE", "IT & Software"),
    Term("BPO_KPO", "BPO / KPO / Customer support"),
    Term("BANKING_FINANCE", "Banking, financial services & insurance"),
    Term("HEALTHCARE", "Healthcare & pharmaceuticals"),
    Term("MANUFACTURING", "Manufacturing & engineering"),
    Term("CONSTRUCTION", "Construction & real estate"),
    Term("RETAIL_ECOMMERCE", "Retail & e-commerce"),
    Term("EDUCATION", "Education & training"),
    Term("LOGISTICS_TRANSPORT", "Logistics & transport"),
    Term("HOSPITALITY_TOURISM", "Hospitality & tourism"),
    Term("MEDIA_ENTERTAINMENT", "Media & entertainment"),
    Term("TELECOM", "Telecom"),
    Term("AGRICULTURE", "Agriculture & agri-business"),
    Term("ENERGY_UTILITIES", "Energy & utilities"),
    Term("AUTOMOTIVE", "Automotive"),
    Term("TEXTILES_APPAREL", "Textiles & apparel"),
    Term("PROFESSIONAL_SERVICES", "Professional & consulting services"),
    Term("GOVERNMENT_PUBLIC", "Government & public administration"),
    Term("OTHER", "Other"),
)

EMPLOYER_TYPE_CODES: Final[frozenset[str]] = frozenset(t.code for t in EMPLOYER_TYPES)
INDUSTRY_CODES: Final[frozenset[str]] = frozenset(t.code for t in INDUSTRIES)


def active_employer_types() -> tuple[Term, ...]:
    return tuple(t for t in EMPLOYER_TYPES if t.active)


def active_industries() -> tuple[Term, ...]:
    return tuple(t for t in INDUSTRIES if t.active)


def is_valid_employer_type(code: str | None) -> bool:
    """`None` is valid: both fields are optional on the employer record, and a
    KYB form part-way through completion has not chosen one yet."""
    return code is None or code in EMPLOYER_TYPE_CODES


def is_valid_industry(code: str | None) -> bool:
    return code is None or code in INDUSTRY_CODES
