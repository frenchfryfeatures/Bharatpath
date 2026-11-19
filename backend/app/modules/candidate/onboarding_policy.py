"""Rules published with form metadata; enforced again when saving."""

from typing import Any

EDUCATION_MAX_YEARS = 7


def field_rules(key: str, required: bool) -> dict[str, Any]:
    required_when = "ALWAYS" if required else "NEVER"
    visible_when = "ALWAYS"
    history = {
        "experience_years",
        "experience_months",
        "company_name",
        "job_title",
        "employment_start",
        "annual_salary",
        "annual_salary_currency",
        "industry",
        "department",
        "role_category",
        "job_role",
    }
    if key in history:
        visible_when = "EXPERIENCED"
    if key in {
        "currently_employed",
        "company_name",
        "job_title",
        "employment_start",
        "annual_salary",
    }:
        required_when = "EXPERIENCED"
    if key == "employment_end":
        visible_when = required_when = "PREVIOUS"
    if key == "notice_period":
        visible_when = "EMPLOYMENT_CHOSEN"
        required_when = "EMPLOYED"
    if key in {"preferred_salary", "key_skills"}:
        required_when = "NEVER"
    if key == "key_skills":
        visible_when = "NEVER"
    if key == "gender":
        required_when = "ALWAYS"
    return {
        "required_when": required_when,
        "visible_when": visible_when,
        "education_max_years": EDUCATION_MAX_YEARS,
    }


def matches(condition: str, details: Any) -> bool:
    if condition == "ALWAYS":
        return True
    if condition == "EMPLOYMENT_CHOSEN":
        return details.currently_employed in {"YES", "NO"}
    if condition == "EMPLOYED":
        return details.currently_employed == "YES"
    if condition == "EXPERIENCED":
        return details.work_status == "EXPERIENCED" or details.currently_employed == "YES"
    if condition == "PREVIOUS":
        return details.work_status == "EXPERIENCED" and details.currently_employed == "NO"
    return False
