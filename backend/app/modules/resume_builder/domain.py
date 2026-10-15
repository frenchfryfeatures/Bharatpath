"""resume_builder - pure domain logic

A resume built from the candidate's own answers, laid out by one of four
templates. **No model is called here**: the first draft is the candidate's
own CV as the review screen already shows it (where they uploaded one), with
the onboarding answers in its gaps; the candidate edits it, and the templates
lay out exactly what is in it.

No I/O. No database, no HTTP, no clock. Everything here works on plain
dicts in the shape of `resume.structuring.StructuredResume` -- the document
both apps already render on their review screens -- which the service
validates on the way in and out. (This module cannot import that schema:
`structuring` reaches the model client, and `domain-is-pure` forbids it even
indirectly.)

Three things leave this module:

* `prefill` -- the first draft, from the CV's structured view and the career
  profile.
* `template_view` -- the draft as the templates draw it: every date, link and
  contact already formatted, so a template only lays strings out and never
  interprets anything a candidate typed.
* `scoring_fields` -- the draft as Layer 1 reads it, in the manual form's
  shape (`scoring.domain.render_structured_resume`). Never a contact, never
  a link: what is scored is what the person did.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final


@dataclass(frozen=True, slots=True)
class Template:
    key: str
    name: str
    description: str
    #: 1 or 2. A client may show it beside the thumbnail.
    columns: int


#: The four layouts. Ours, not the client's: see `TEMPLATES_VERSION`.
TEMPLATES: Final[tuple[Template, ...]] = (
    Template(
        "classic",
        "Classic",
        "Computer Modern serif, centred name and ruled small-caps headings: "
        "the LaTeX article look.",
        1,
    ),
    Template(
        "modern",
        "Modern",
        "Clean sans-serif with an accent colour and the dates set to the right.",
        1,
    ),
    Template(
        "sidebar",
        "Sidebar",
        "Two columns: contact details, skills and languages in a tinted sidebar, "
        "experience and education beside it.",
        2,
    ),
    Template(
        "minimal",
        "Minimal",
        "A quiet serif with no colour and generous spacing, plain enough for any "
        "applicant tracking system.",
        1,
    ),
)
TEMPLATE_KEYS: Final[tuple[str, ...]] = tuple(t.key for t in TEMPLATES)
DEFAULT_TEMPLATE: Final = "classic"

#: **Placeholder.** The four designs are ours, made 2026-10-13 without a
#: designer or the client. Bump it whenever a `.typ` file changes: it is
#: stored on every pushed version, so the PDF an employer saw can be traced to
#: the layout that drew it. Replacing the designs is a client decision.
TEMPLATES_VERSION: Final = "placeholder-2026-10-13"

#: Stored as the version's `extractor`, like every other source records its
#: parser: a different builder produces a different document.
PARSER: Final = "builder"
PARSER_VERSION: Final = "1"

#: The longest draft, as stored JSON. A dense two-page CV is under 10,000
#: characters; this leaves room and keeps the scored text under the 30,000
#: characters an upload may have (`MAX_TEXT_CHARS`).
MAX_CONTENT_CHARS: Final = 40_000


# ---------------------------------------------------------------------------
# What the builder refuses
# ---------------------------------------------------------------------------
#: The free-text sections are where a "Personal Details" block lands. The
#: platform never records date of birth, age, gender, marital status,
#: religion, caste or family (invariant 5; `structuring` drops the same lines
#: from a read CV), so the builder refuses to print them rather than dropping
#: them silently from under the candidate's cursor.
_PERSONAL_DETAIL: Final = re.compile(
    r"\b(date\s+of\s+birth|d\.?\s?o\.?\s?b\.?|born|age|gender|sex|marital|married|"
    r"unmarried|religion|caste|nationality|father|mother|husband|wife|spouse)\b",
    re.IGNORECASE,
)
_PARTIAL_DATE: Final = re.compile(r"^(?:(19|20)\d{2})(?:-(0[1-9]|1[0-2]))?$")


def personal_detail_fields(doc: Mapping[str, Any]) -> list[str]:
    """Where the draft states a personal detail it may not carry, as field
    paths. Empty when it states none."""
    found: list[str] = []
    for i, section in enumerate(_dicts(doc.get("other_sections"))):
        if _PERSONAL_DETAIL.search(_text(section.get("heading"))):
            found.append(f"other_sections[{i}].heading")
        for j, item in enumerate(_strings(section.get("items"))):
            if _PERSONAL_DETAIL.search(item):
                found.append(f"other_sections[{i}].items[{j}]")
    for i, item in enumerate(_strings(doc.get("interests"))):
        if _PERSONAL_DETAIL.search(item):
            found.append(f"interests[{i}]")
    return found


def malformed_date_fields(doc: Mapping[str, Any]) -> list[str]:
    """Dates that are not `YYYY`, `YYYY-MM` or empty. A template prints a
    month name, so a free-form date is refused rather than guessed at."""
    found: list[str] = []
    checks = (
        ("experience", ("start_date", "end_date")),
        ("education", ("start_date", "end_date")),
        ("projects", ("start_date", "end_date")),
        ("certifications", ("issue_date", "expiry_date")),
    )
    for section, keys in checks:
        for i, entry in enumerate(_dicts(doc.get(section))):
            for key in keys:
                value = _text(entry.get(key))
                if value and not _PARTIAL_DATE.match(value):
                    found.append(f"{section}[{i}].{key}")
            start, end = _text(entry.get(keys[0])), _text(entry.get(keys[1]))
            both = start and end and _PARTIAL_DATE.match(start) and _PARTIAL_DATE.match(end)
            if both and end < start:
                found.append(f"{section}[{i}].{keys[1]}")
    return found


def missing_for_push(doc: Mapping[str, Any]) -> list[str]:
    """What a draft must have before it can become the candidate's resume: a
    name (employers see it) and something to score."""
    missing = []
    if not _text(doc.get("full_name")).strip():
        missing.append("full_name")
    if not (
        _dicts(doc.get("experience")) or _dicts(doc.get("education")) or _strings(doc.get("skills"))
    ):
        missing.append("experience")
    return missing


# ---------------------------------------------------------------------------
# The first draft
# ---------------------------------------------------------------------------
def prefill(
    *,
    full_name: str,
    email: str,
    details: Mapping[str, Any],
    resume: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """The first draft: the candidate's own CV where one was read, the
    onboarding answers for the rest.

    `resume` is the review screen's view of a CV they uploaded
    (`StructuredResume` as a dict), or None. With it, the draft starts from
    everything the CV states -- every job, every qualification, projects,
    certifications -- and the answers fill only what it leaves blank. A
    candidate who already has a CV should not retype it.

    Without it, a field-by-field copy of the answers (`_from_answers`).
    """
    answers = _from_answers(full_name=full_name, email=email, details=details)
    if not resume:
        return answers
    return _printable(_merged(resume=resume, answers=answers))


def _merged(*, resume: Mapping[str, Any], answers: Mapping[str, Any]) -> dict[str, Any]:
    """The CV, with the answers in its gaps. The name, headline and city are
    the answers' first: the candidate typed them for us, and the name is the
    one asked at sign-up."""
    draft = copy.deepcopy(dict(resume))
    for key in ("full_name", "headline", "location"):
        draft[key] = _text(answers.get(key)).strip() or _text(resume.get(key)).strip()
    contacts = dict(draft.get("contacts") or {})
    for key, value in (answers.get("contacts") or {}).items():
        if not _text(contacts.get(key)).strip():
            contacts[key] = value
    draft["contacts"] = contacts
    for key in ("experience", "education"):
        draft[key] = _dicts(draft.get(key)) or copy.deepcopy(list(answers.get(key) or []))
    skills: dict[str, str] = {}
    for skill in [*_strings(draft.get("skills")), *_strings(answers.get("skills"))]:
        skills.setdefault(skill.strip().lower(), skill.strip())
    draft["skills"] = [s for s in skills.values() if s][:MAX_SKILLS]
    return draft


#: `StructuredResume.skills` holds no more.
MAX_SKILLS: Final = 150


def _printable(doc: dict[str, Any]) -> dict[str, Any]:
    """A draft from a read CV, without what the builder would refuse to save.

    The candidate did not type these, so refusing them would be refusing the
    candidate for our reading: a personal-details line is dropped (the
    structuring prompt already asks for none), and a date a template cannot
    print is left empty for them to fill.
    """
    sections = []
    for section in _dicts(doc.get("other_sections")):
        items = _strings(section.get("items"))
        kept = [i for i in items if not _personal(i)]
        # A "Personal details" block emptied by the filter goes with it.
        if not _personal(_text(section.get("heading"))) and (kept or not items):
            sections.append({**section, "items": kept})
    doc["other_sections"] = sections
    doc["interests"] = [i for i in _strings(doc.get("interests")) if not _personal(i)]
    for path in malformed_date_fields(doc):
        name, rest = path.split("[", 1)
        index, key = rest.split("].", 1)
        doc[name][int(index)] = {**doc[name][int(index)], key: ""}
    return doc


def _personal(text: str) -> bool:
    return _PERSONAL_DETAIL.search(text) is not None


def _from_answers(*, full_name: str, email: str, details: Mapping[str, Any]) -> dict[str, Any]:
    """The onboarding answers as a draft. A field-by-field copy.

    `details` is the career profile (`candidate.career.CareerDetails`) as a
    dict. **Never copied:** gender, salary, notice period and preferred
    locations. A resume goes to employers; none of those belong on one, and
    gender is exactly what masked search exists to keep out of a decision.
    """
    current_job = _text(details.get("currently_employed")) == "YES" and _text(
        details.get("company_name")
    )
    experience = (
        [
            {
                "job_title": _text(details.get("job_title")),
                "company": _text(details.get("company_name")),
                "start_date": _text(details.get("employment_start")),
                "end_date": "",
                "is_current": True,
            }
        ]
        if current_job
        else []
    )
    qualification = _text(details.get("course")) or _text(details.get("highest_qualification"))
    institution = _text(details.get("institution"))
    education = (
        [
            {
                "qualification": qualification,
                "field_of_study": _text(details.get("specialization_name"))
                or _text(details.get("specialization")),
                "institution": institution,
                "start_date": _year(details.get("starting_year")),
                "end_date": _year(details.get("passing_year")),
            }
        ]
        if qualification or institution
        else []
    )
    return {
        "full_name": full_name.strip(),
        "headline": _text(details.get("headline")) or _text(details.get("job_role")),
        "location": _text(details.get("current_city")),
        "summary": "",
        "contacts": {"email": email.strip(), "phone": _text(details.get("phone"))},
        "experience": experience,
        "education": education,
        "skills": _strings(details.get("key_skills")),
    }


# ---------------------------------------------------------------------------
# What a template draws
# ---------------------------------------------------------------------------
#: Section headings. English: a resume is read by employers, and the
#: templates set English hyphenation and quotes.
HEADINGS: Final[Mapping[str, str]] = {
    "summary": "Summary",
    "experience": "Experience",
    "education": "Education",
    "skills": "Skills",
    "projects": "Projects",
    "certifications": "Certifications",
    "languages": "Languages",
    "achievements": "Achievements",
    "interests": "Interests",
    "contact": "Contact",
}

_MONTHS: Final = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)
#: The profile links `StructuredResume.contacts` names, in the order printed.
_LINK_FIELDS: Final = (
    ("linkedin", "LinkedIn"),
    ("github", "GitHub"),
    ("website", "Website"),
    ("behance", "Behance"),
    ("medium", "Medium"),
    ("dev_to", "DEV"),
    ("stack_overflow", "Stack Overflow"),
    ("x_twitter", "X"),
    ("instagram", "Instagram"),
    ("pinterest", "Pinterest"),
    ("tiktok", "TikTok"),
)
_SCHEME: Final = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)
_WEB: Final = re.compile(r"^https?://[^\s<>\"]+$", re.IGNORECASE)
_EMAIL: Final = re.compile(r"^[^@\s<>\"]+@[^@\s<>\"]+\.[^@\s<>\"]+$")


def full_url(value: str) -> str:
    """A bare `linkedin.com/in/x` becomes `https://linkedin.com/in/x`; a value
    with any other scheme is left alone, and `template_view` will not link it."""
    value = value.strip()
    if not value or _SCHEME.match(value) or " " in value or "." not in value:
        return value
    return f"https://{value}"


def safe_link(value: str) -> str:
    """The URL a template may link, or `""`. **Only http and https.** A
    `javascript:` or `file:` link in a PDF is an action the viewer runs."""
    url = full_url(value)
    return url if _WEB.match(url) else ""


def display_url(url: str) -> str:
    """How a link is printed: without the scheme, `www.` or a trailing slash."""
    shown = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    return shown.removeprefix("www.").rstrip("/")


def format_date(value: str) -> str:
    """`2024-03` -> `Mar 2024`; `2024` -> `2024`; anything else as typed."""
    match = _PARTIAL_DATE.match(value.strip())
    if not match:
        return value.strip()
    year, _, month = value.strip().partition("-")
    return f"{_MONTHS[int(month) - 1]} {year}" if month else year


#: Between two dates, as typeset: an en dash with spaces.
_EN_DASH: Final = " – "  # noqa: RUF001 - the en dash is the point


def date_range(start: str, end: str, *, current: bool = False) -> str:
    first, last = format_date(start), format_date(end)
    if current:
        last = "Present"
    if first and last:
        return first if first == last else f"{first}{_EN_DASH}{last}"
    return first or last


def template_view(doc: Mapping[str, Any]) -> dict[str, Any]:
    """The draft as every template reads it.

    All formatting happens here, so it is tested once rather than four times
    in Typst, and so no template ever parses a candidate's text: each value
    reaches the layout as a string and Typst prints a string as it is.
    """
    contacts = doc.get("contacts") if isinstance(doc.get("contacts"), Mapping) else {}
    assert isinstance(contacts, Mapping)
    contact_items: list[dict[str, str]] = []
    email = _text(contacts.get("email")).strip().removeprefix("mailto:")
    if email:
        contact_items.append(
            {
                "label": "Email",
                "text": email,
                "url": f"mailto:{email}" if _EMAIL.match(email) else "",
            }
        )
    phone = _text(contacts.get("phone")).strip()
    if phone:
        contact_items.append({"label": "Phone", "text": phone, "url": ""})
    location = _text(doc.get("location")).strip()
    if location:
        contact_items.append({"label": "Location", "text": location, "url": ""})
    for field, label in _LINK_FIELDS:
        contact_items.extend(_link_item(label, _text(contacts.get(field))))
    for other in _dicts(contacts.get("others")):
        contact_items.extend(
            _link_item(_text(other.get("label")).strip() or "Link", _text(other.get("url")))
        )

    return {
        "name": _text(doc.get("full_name")).strip(),
        "headline": _text(doc.get("headline")).strip(),
        "location": location,
        "summary": _text(doc.get("summary")).strip(),
        "contacts": contact_items,
        "experience": [
            {
                "title": _text(e.get("job_title")).strip(),
                "company": _text(e.get("company")).strip(),
                "location": _text(e.get("location")).strip(),
                "kind": _text(e.get("employment_type")).strip(),
                "dates": date_range(
                    _text(e.get("start_date")),
                    _text(e.get("end_date")),
                    current=e.get("is_current") is True,
                ),
                "description": _text(e.get("description")).strip(),
                "highlights": _nonblank(e.get("highlights")),
                "skills": ", ".join(_nonblank(e.get("skills_used"))),
            }
            for e in _dicts(doc.get("experience"))
        ],
        "education": [
            {
                "qualification": _text(e.get("qualification")).strip(),
                "field": _text(e.get("field_of_study")).strip(),
                "institution": _text(e.get("institution")).strip(),
                "location": _text(e.get("location")).strip(),
                "dates": date_range(_text(e.get("start_date")), _text(e.get("end_date"))),
                "grade": _text(e.get("grade")).strip(),
                "description": _text(e.get("description")).strip(),
            }
            for e in _dicts(doc.get("education"))
        ],
        "skills": _nonblank(doc.get("skills")),
        "projects": [
            {
                "name": _text(p.get("name")).strip(),
                "role": _text(p.get("role")).strip(),
                "dates": date_range(_text(p.get("start_date")), _text(p.get("end_date"))),
                "description": _text(p.get("description")).strip(),
                "technologies": ", ".join(_nonblank(p.get("technologies"))),
                **_url_fields(_text(p.get("url"))),
            }
            for p in _dicts(doc.get("projects"))
        ],
        "certifications": [
            {
                "name": _text(c.get("name")).strip(),
                "issuer": _text(c.get("issuer")).strip(),
                "dates": date_range(_text(c.get("issue_date")), _text(c.get("expiry_date"))),
                "credential": _text(c.get("credential_id")).strip(),
                **_url_fields(_text(c.get("url"))),
            }
            for c in _dicts(doc.get("certifications"))
        ],
        "languages": [
            {
                "name": _text(lang.get("name")).strip(),
                "level": _text(lang.get("proficiency")).strip(),
            }
            for lang in _dicts(doc.get("languages"))
            if _text(lang.get("name")).strip()
        ],
        "achievements": _nonblank(doc.get("achievements")),
        "interests": _nonblank(doc.get("interests")),
        "other_sections": [
            {"heading": _text(s.get("heading")).strip(), "items": _nonblank(s.get("items"))}
            for s in _dicts(doc.get("other_sections"))
            if _nonblank(s.get("items"))
        ],
        "headings": dict(HEADINGS),
    }


def _link_item(label: str, value: str) -> list[dict[str, str]]:
    if not value.strip():
        return []
    url = safe_link(value)
    return [{"label": label, "text": display_url(url) if url else value.strip(), "url": url}]


def _url_fields(value: str) -> dict[str, str]:
    url = safe_link(value)
    return {"url": url, "url_text": display_url(url) if url else value.strip()}


# ---------------------------------------------------------------------------
# What is scored
# ---------------------------------------------------------------------------
def scoring_fields(doc: Mapping[str, Any]) -> dict[str, Any]:
    """The draft in the manual form's shape, which `score_resume` renders to
    text when a version has no `raw_text` (`render_structured_resume`).

    `full_name` is kept because `resume.service.declared_name` reads it for an
    employer who opened the profile; the renderer leaves it out of the text.
    **No contact, no link, no location, no completion year**: none of them
    says what the person can do, and the year says a great deal about age.
    Deterministic, because the text it renders to keys the extraction cache.
    """
    experience = []
    for e in _dicts(doc.get("experience")):
        lines = [_text(e.get("description")).strip()]
        lines += [f"- {h}" for h in _nonblank(e.get("highlights"))]
        used = _nonblank(e.get("skills_used"))
        if used:
            lines.append("Skills used: " + ", ".join(used))
        experience.append(
            {
                "employer": _text(e.get("company")).strip(),
                "title": _text(e.get("job_title")).strip(),
                "start_year": _year_of(_text(e.get("start_date"))),
                "end_year": None
                if e.get("is_current") is True
                else _year_of(_text(e.get("end_date"))),
                "summary": "\n".join(line for line in lines if line) or None,
            }
        )
    education = [
        {
            "institution": _text(e.get("institution")).strip(),
            "qualification": ", ".join(
                part
                for part in (
                    _text(e.get("qualification")).strip(),
                    _text(e.get("field_of_study")).strip(),
                    _text(e.get("grade")).strip(),
                )
                if part
            ),
        }
        for e in _dicts(doc.get("education"))
    ]
    projects = []
    for p in _dicts(doc.get("projects")):
        parts = [_text(p.get("role")).strip(), _text(p.get("description")).strip()]
        technologies = _nonblank(p.get("technologies"))
        if technologies:
            parts.append("Technologies: " + ", ".join(technologies))
        projects.append(
            {"name": _text(p.get("name")).strip(), "summary": "\n".join(x for x in parts if x)}
        )
    certifications = [
        " - ".join(x for x in (_text(c.get("name")).strip(), _text(c.get("issuer")).strip()) if x)
        for c in _dicts(doc.get("certifications"))
    ]
    languages = [
        " - ".join(
            x
            for x in (_text(lang.get("name")).strip(), _text(lang.get("proficiency")).strip())
            if x
        )
        for lang in _dicts(doc.get("languages"))
    ]
    return {
        "full_name": _text(doc.get("full_name")).strip(),
        "headline": _text(doc.get("headline")).strip() or None,
        "summary": _text(doc.get("summary")).strip(),
        "experience": experience,
        "education": education,
        "skills": _nonblank(doc.get("skills")),
        "projects": [p for p in projects if p["name"] or p["summary"]],
        "certifications": [c for c in certifications if c],
        "languages": [x for x in languages if x],
        "achievements": _nonblank(doc.get("achievements")),
    }


# ---------------------------------------------------------------------------
def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def _strings(value: object) -> list[str]:
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def _nonblank(value: object) -> list[str]:
    return [v.strip() for v in _strings(value) if v.strip()]


def _dicts(value: object) -> list[Mapping[str, Any]]:
    return (
        [v for v in value if isinstance(v, Mapping)]
        if isinstance(value, Sequence) and not isinstance(value, str)
        else []
    )


def _year(value: object) -> str:
    return str(value) if isinstance(value, int) and not isinstance(value, bool) else ""


def _year_of(value: str) -> int | None:
    match = _PARTIAL_DATE.match(value.strip())
    return int(value.strip()[:4]) if match else None
