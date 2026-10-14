"""The resume builder without a database: the first draft, the formatting,
the scored text, and every template drawn for real (2026-10-13).

No model anywhere. What is checked here is that the draft is a faithful copy
of what the candidate gave, that a template prints what it is handed and
nothing else, and that the scored text never carries who the person is.
"""

from __future__ import annotations

import asyncio
import base64
import io
import typing
from typing import Any

import pypdf
import pytest

from app.modules.resume.structuring import StructuredResume
from app.modules.resume_builder import domain, rendering
from app.modules.resume_builder.schemas import TemplateKey
from app.modules.scoring.domain import render_structured_resume

CAREER: dict[str, Any] = {
    "phone": "+919876543210",
    "work_status": "EXPERIENCED",
    "currently_employed": "YES",
    "experience_years": 3,
    "company_name": "Reliance Retail",
    "job_title": "Data Analyst",
    "current_city": "Pune",
    "employment_start": "2022-07",
    "annual_salary": 900000,
    "notice_period": "30_DAYS",
    "key_skills": ["SQL", "Power BI"],
    "job_role": "Analytics",
    "highest_qualification": "Graduation",
    "course": "B.Com",
    "specialization_name": "Accounting",
    "institution": "Fergusson College",
    "starting_year": 2018,
    "passing_year": 2021,
    "headline": "Data analyst",
    "preferred_locations": ["Mumbai"],
    "preferred_salary": 1200000,
    "gender": "FEMALE",
}

FULL: dict[str, Any] = {
    "full_name": "Priya Sharma",
    "headline": "Data Analyst",
    "location": "Pune",
    "summary": "Three years turning retail data into weekly dashboards.",
    "contacts": {
        "email": "priya@example.com",
        "phone": "+91 98765 43210",
        "linkedin": "linkedin.com/in/priya",
        "others": [{"label": "Portfolio", "url": "priya.dev"}],
    },
    "experience": [
        {
            "job_title": "Data Analyst",
            "company": "Reliance Retail",
            "start_date": "2022-07",
            "is_current": True,
            "description": "Weekly sales reporting for 140 stores.",
            "highlights": ["Cut a two-day reconciliation to 20 minutes."],
            "skills_used": ["SQL"],
        }
    ],
    "education": [
        {
            "qualification": "B.Com",
            "field_of_study": "Accounting",
            "institution": "Fergusson College",
            "start_date": "2018",
            "end_date": "2021",
            "grade": "8.4 CGPA",
        }
    ],
    "skills": ["SQL", "Power BI"],
    "projects": [
        {"name": "Monsoon forecast", "description": "Demand from rainfall.", "url": "x.dev"}
    ],
    "certifications": [{"name": "Google Data Analytics", "issuer": "Coursera"}],
    "languages": [{"name": "Hindi", "proficiency": "Native"}],
    "achievements": ["Regional analytics award"],
    "interests": ["Chess"],
}

#: How a template joins two dates.
DASH = chr(0x2013)

HOSTILE_NAME = '#set text(red) #read("/etc/hosts") \\input{x} *b* $x$ <l> @r ]]'


def _doc(**overrides: Any) -> dict[str, Any]:
    return StructuredResume.model_validate({**FULL, **overrides}).model_dump(mode="json")


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
def test_the_schema_literal_names_exactly_the_templates() -> None:
    assert set(typing.get_args(TemplateKey)) == set(domain.TEMPLATE_KEYS)
    assert domain.DEFAULT_TEMPLATE in domain.TEMPLATE_KEYS
    for key in domain.TEMPLATE_KEYS:
        assert (rendering.TEMPLATE_DIR / f"{key}.typ").is_file()


def test_the_designs_are_still_ours() -> None:
    """Flipping this is a client decision: see CLAUDE.md, placeholder content."""
    assert domain.TEMPLATES_VERSION.startswith("placeholder-")


def test_the_draft_has_no_field_for_who_someone_is_beyond_their_name() -> None:
    """Invariant 5, and a photo or the score never reaches an employer."""
    forbidden = ("birth", "age", "gender", "sex", "photo", "score", "marital", "religion")

    def walk(model: type[Any], path: str) -> list[str]:
        found = []
        for name, field in model.model_fields.items():
            if any(word == name or name.startswith(word + "_") for word in forbidden):
                found.append(f"{path}{name}")
            for arg in typing.get_args(field.annotation) or (field.annotation,):
                inner = typing.get_args(arg) or (arg,)
                for candidate in inner:
                    if isinstance(candidate, type) and hasattr(candidate, "model_fields"):
                        found += walk(candidate, f"{path}{name}.")
        return found

    assert walk(StructuredResume, "") == []


# ---------------------------------------------------------------------------
# The first draft
# ---------------------------------------------------------------------------
def test_the_first_draft_copies_the_answers_field_by_field() -> None:
    draft = domain.prefill(full_name="Priya Sharma ", email="priya@example.com", details=CAREER)
    StructuredResume.model_validate(draft)
    assert draft["full_name"] == "Priya Sharma"
    assert draft["contacts"] == {"email": "priya@example.com", "phone": "+919876543210"}
    assert draft["location"] == "Pune"
    assert draft["headline"] == "Data analyst"
    assert draft["skills"] == ["SQL", "Power BI"]
    assert draft["experience"] == [
        {
            "job_title": "Data Analyst",
            "company": "Reliance Retail",
            "start_date": "2022-07",
            "end_date": "",
            "is_current": True,
        }
    ]
    assert draft["education"][0] == {
        "qualification": "B.Com",
        "field_of_study": "Accounting",
        "institution": "Fergusson College",
        "start_date": "2018",
        "end_date": "2021",
    }


def test_the_first_draft_never_carries_gender_salary_or_preferences() -> None:
    text = str(domain.prefill(full_name="P", email="", details=CAREER))
    for leaked in ("FEMALE", "900000", "1200000", "30_DAYS", "Mumbai"):
        assert leaked not in text


def test_a_fresher_gets_no_invented_job() -> None:
    fresher = {**CAREER, "work_status": "FRESHER", "currently_employed": "", "company_name": ""}
    assert domain.prefill(full_name="P", email="", details=fresher)["experience"] == []
    assert domain.prefill(full_name="P", email="", details={})["education"] == []


# ---------------------------------------------------------------------------
# What the builder refuses
# ---------------------------------------------------------------------------
def test_a_personal_details_section_is_named_not_dropped() -> None:
    doc = _doc(
        other_sections=[
            {"heading": "Personal details", "items": ["Date of birth: 1 Jan 2000", "Hobbies"]},
            {"heading": "Marital status", "items": ["Single"]},
        ],
        interests=["Chess", "Married life"],
    )
    assert domain.personal_detail_fields(doc) == [
        "other_sections[0].items[0]",
        "other_sections[1].heading",
        "interests[1]",
    ]
    assert domain.personal_detail_fields(_doc()) == []


def test_dates_are_a_year_or_a_year_and_month_and_run_forwards() -> None:
    doc = _doc(
        experience=[
            {"start_date": "2022/07"},
            {"start_date": "2023-05", "end_date": "2022-01"},
            {"start_date": "2023-13"},
        ]
    )
    assert domain.malformed_date_fields(doc) == [
        "experience[0].start_date",
        "experience[1].end_date",
        "experience[2].start_date",
    ]
    assert domain.malformed_date_fields(_doc()) == []


def test_a_push_needs_a_name_and_something_to_score() -> None:
    assert domain.missing_for_push(_doc()) == []
    empty = _doc(full_name=" ", experience=[], education=[], skills=[])
    assert domain.missing_for_push(empty) == ["full_name", "experience"]


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("start", "end", "current", "shown"),
    [
        ("2022-07", "", True, f"Jul 2022 {DASH} Present"),
        ("2021-12", "2022-06", False, f"Dec 2021 {DASH} Jun 2022"),
        ("2018", "2021", False, f"2018 {DASH} 2021"),
        ("2020", "2020", False, "2020"),
        ("", "2021", False, "2021"),
        ("", "", True, "Present"),
        ("", "", False, ""),
    ],
)
def test_date_ranges(start: str, end: str, current: bool, shown: str) -> None:
    assert domain.date_range(start, end, current=current) == shown


@pytest.mark.parametrize(
    ("typed", "linked"),
    [
        ("linkedin.com/in/priya", "https://linkedin.com/in/priya"),
        ("https://github.com/p", "https://github.com/p"),
        ("javascript:alert(1)", ""),
        ("file:///etc/passwd", ""),
        ("data:text/html,x", ""),
        ("not a url", ""),
    ],
)
def test_only_web_links_are_linked(typed: str, linked: str) -> None:
    assert domain.safe_link(typed) == linked


def test_the_template_view_formats_everything() -> None:
    view = domain.template_view(_doc())
    assert view["name"] == "Priya Sharma"
    assert [c["text"] for c in view["contacts"]] == [
        "priya@example.com",
        "+91 98765 43210",
        "Pune",
        "linkedin.com/in/priya",
        "priya.dev",
    ]
    assert view["contacts"][0]["url"] == "mailto:priya@example.com"
    assert view["contacts"][3]["url"] == "https://linkedin.com/in/priya"
    assert view["experience"][0]["dates"] == f"Jul 2022 {DASH} Present"
    assert view["projects"][0]["url"] == "https://x.dev"


# ---------------------------------------------------------------------------
# What is scored
# ---------------------------------------------------------------------------
def test_the_scored_text_says_what_they_did_and_not_who_they_are() -> None:
    text = render_structured_resume(domain.scoring_fields(_doc()))
    for present in (
        "Data Analyst at Reliance Retail, 2022 to present",
        "Cut a two-day reconciliation to 20 minutes.",
        "Summary: Three years",
        "B.Com, Accounting, 8.4 CGPA, Fergusson College",
        "Skills: SQL, Power BI",
        "Monsoon forecast",
        "Google Data Analytics - Coursera",
        "Regional analytics award",
    ):
        assert present in text, present
    for absent in ("Priya", "priya@example.com", "98765", "linkedin", "priya.dev", "Pune", "2021"):
        assert absent not in text, absent


def test_a_manual_form_renders_exactly_as_it_always_did() -> None:
    """The builder's keys print only when present. A manual-form version has
    none, so its text -- the extraction cache key -- is unchanged."""
    manual = {
        "full_name": "Asha",
        "headline": "Welder",
        "experience": [
            {
                "employer": "L&T",
                "title": "Welder",
                "start_year": 2019,
                "end_year": None,
                "summary": "TIG and MIG.",
            }
        ],
        "education": [
            {"institution": "ITI Pune", "qualification": "Welder trade", "completed_year": 2018}
        ],
        "skills": ["TIG", "MIG"],
        "extractor": {"parser": "manual", "parser_version": "1"},
    }
    assert render_structured_resume(manual) == (
        "Headline: Welder\n"
        "Experience:\n"
        "- Welder at L&T, 2019 to present\n"
        "  TIG and MIG.\n"
        "Education:\n"
        "- Welder trade, ITI Pune\n"
        "Skills: TIG, MIG"
    )


# ---------------------------------------------------------------------------
# Every template, drawn
# ---------------------------------------------------------------------------
def _pdf(key: str, doc: dict[str, Any]) -> bytes:
    return asyncio.run(rendering.pdf(key, domain.template_view(doc)))


def _text_and_links(document: bytes) -> tuple[str, list[str]]:
    reader = pypdf.PdfReader(io.BytesIO(document))
    text = "".join(page.extract_text() for page in reader.pages)
    links = [
        str(annot.get_object().get("/A", {}).get("/URI"))
        for page in reader.pages
        for annot in (page.get("/Annots") or [])
    ]
    return text, links


@pytest.mark.parametrize("key", domain.TEMPLATE_KEYS)
def test_every_template_draws_an_empty_and_a_full_draft(key: str) -> None:
    empty = _pdf(key, {})
    assert empty.startswith(b"%PDF")
    full = _pdf(key, _doc())
    text, links = _text_and_links(full)
    for shown in ("Priya Sharma", "Reliance Retail", "Fergusson College", "Coursera"):
        assert shown in text, shown
    assert "mailto:priya@example.com" in links
    assert "https://linkedin.com/in/priya" in links


@pytest.mark.parametrize("key", domain.TEMPLATE_KEYS)
def test_a_template_prints_what_it_is_handed_and_runs_none_of_it(key: str) -> None:
    hostile = _doc(
        full_name=HOSTILE_NAME,
        contacts={
            "email": "x@y.z",
            "linkedin": "javascript:alert(1)",
            "others": [{"label": "f", "url": "file:///etc/passwd"}],
        },
    )
    text, links = _text_and_links(_pdf(key, hostile))
    text = "".join(text.splitlines())  # a long name wraps
    assert '#read("/etc/hosts")' in text
    assert "#set text(red)" in text
    assert all(link.startswith(("https://", "mailto:")) for link in links), links


@pytest.mark.parametrize("key", domain.TEMPLATE_KEYS)
def test_the_same_draft_draws_the_same_bytes(key: str) -> None:
    """No creation date, no system fonts: a resume is a function of its draft."""
    assert _pdf(key, _doc()) == _pdf(key, _doc())


def test_indian_scripts_are_drawn_from_the_bundled_fonts() -> None:
    names = "प्रिया প্রিয়া"
    text, _ = _text_and_links(_pdf("modern", _doc(full_name=names)))
    assert "प" in text and "প" in text


def test_a_preview_is_one_png_per_page() -> None:
    long = _doc(experience=FULL["experience"] * 12)
    pages, count = asyncio.run(rendering.preview("sidebar", domain.template_view(long)))
    assert count >= 2 and len(pages) == count
    assert all(base64.b64decode(p).startswith(b"\x89PNG") for p in pages)
    svg, _ = asyncio.run(rendering.preview("classic", domain.template_view(_doc()), fmt="svg"))
    assert base64.b64decode(svg[0]).lstrip().startswith(b"<svg")


def test_an_unknown_template_is_refused_before_typst() -> None:
    with pytest.raises(rendering.ResumeRenderError):
        asyncio.run(rendering.pdf("../../etc/passwd", {}))
