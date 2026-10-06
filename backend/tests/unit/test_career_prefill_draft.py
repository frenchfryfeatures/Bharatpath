"""The prefill keeps every fact the model got right (2026-10-06).

Production answered `resume_prefill_unavailable` (503) when the model wrote
"Bengaluru, Karnataka" as the city: the comma is refused by `normalise_city`,
and one refused field threw the whole draft away. Reproduced on the live host
in one run of eight. Each field the rules refuse is now left blank instead;
the rules themselves are unchanged.
"""

from __future__ import annotations

from typing import Any

from app.modules.candidate.extraction import draft_from


def answer(**overrides: Any) -> dict[str, Any]:
    """A valid model answer, as the strict schema returns it."""
    base: dict[str, Any] = {
        "full_name": "Rahul Sharma",
        "email": "rahul@example.invalid",
        "phone": "+919876543210",
        "work_status": "EXPERIENCED",
        "currently_employed": "YES",
        "experience_years": 6,
        "experience_months": 0,
        "company_name": "Flipkart",
        "job_title": "Senior Software Engineer",
        "current_city": "Bengaluru",
        "employment_start": "2021-07",
        "employment_end": "",
        "key_skills": ["Python", "Go"],
        "highest_qualification": "B.Tech",
        "institution": "VIT Vellore",
        "starting_year": 2014,
        "passing_year": 2018,
    }
    return {**base, **overrides}


def test_a_valid_answer_is_kept_whole() -> None:
    draft = draft_from(answer())
    assert draft.current_city == "Bengaluru"
    assert draft.company_name == "Flipkart"


def test_a_city_with_its_state_is_left_blank_and_nothing_else_is_lost() -> None:
    """The production failure."""
    draft = draft_from(answer(current_city="Bengaluru, Karnataka"))
    assert draft.current_city == ""
    assert draft.full_name == "Rahul Sharma"
    assert draft.phone == "+919876543210"
    assert draft.company_name == "Flipkart"
    assert draft.passing_year == 2018


def test_a_city_carrying_a_pin_code_is_never_kept() -> None:
    """The city is on every employer's masked card. Blanking it is the rule
    holding, not the rule relaxed."""
    assert draft_from(answer(current_city="Pune 411001")).current_city == ""


def test_a_phone_with_spaces_is_left_blank() -> None:
    draft = draft_from(answer(phone="+91 98765 43210"))
    assert draft.phone == ""
    assert draft.current_city == "Bengaluru"


def test_a_date_that_is_not_year_month_is_left_blank() -> None:
    draft = draft_from(answer(employment_start="2021"))
    assert draft.employment_start == ""
    assert draft.job_title == "Senior Software Engineer"


def test_education_years_out_of_order_lose_one_year_not_the_draft() -> None:
    draft = draft_from(answer(starting_year=2018, passing_year=2014))
    assert draft.starting_year == 2018
    assert draft.passing_year is None
    assert draft.institution == "VIT Vellore"


def test_a_fresher_with_experience_keeps_fresher_and_drops_the_experience() -> None:
    draft = draft_from(answer(work_status="FRESHER", currently_employed="", experience_years=2))
    assert draft.work_status == "FRESHER"
    assert draft.experience_years == 0


def test_one_overlong_skill_is_dropped_and_the_others_kept() -> None:
    draft = draft_from(answer(key_skills=["Python", "x" * 81, "Go"]))
    assert draft.key_skills == ["Python", "Go"]


def test_an_overlong_text_field_is_left_blank() -> None:
    draft = draft_from(answer(headline="h" * 301))
    assert draft.headline == ""
    assert draft.company_name == "Flipkart"


def test_several_bad_fields_are_all_blanked_together() -> None:
    draft = draft_from(
        answer(current_city="Bengaluru, KA", phone="98765 43210", employment_start="July 2021")
    )
    assert (draft.current_city, draft.phone, draft.employment_start) == ("", "", "")
    assert draft.full_name == "Rahul Sharma"


def test_something_that_is_not_an_object_is_an_empty_draft() -> None:
    assert draft_from(["not", "an", "object"]).model_dump() == draft_from({}).model_dump()
