import pytest
from pydantic import ValidationError
from app.modules.candidate.career import CareerDetails, missing_required, form_fields


def test_previous_employment_is_preserved_and_immediate_joining_is_derived():
    details = CareerDetails(work_status="EXPERIENCED", currently_employed="NO",
        company_name="Previous Employer", job_title="Engineer", employment_start="2020-01",
        employment_end="2024-02", annual_salary=75000, annual_salary_currency="USD", notice_period="90_DAYS")
    assert details.company_name == "Previous Employer"
    assert details.annual_salary == 75000
    assert details.annual_salary_currency == "USD"
    assert details.employment_end == "2024-02"
    assert details.notice_period == "IMMEDIATE"


def test_employed_candidates_must_supply_notice_period_on_completion():
    details = CareerDetails(work_status="EXPERIENCED", currently_employed="YES")
    assert "notice_period" in missing_required(details)
    assert "notice_period" not in missing_required(details.model_copy(update={"notice_period": "30_DAYS"}))


def test_previous_employment_end_is_required_but_freshers_need_no_history():
    previous = CareerDetails(work_status="EXPERIENCED", currently_employed="NO")
    assert {"company_name", "job_title", "employment_start", "employment_end"} <= set(missing_required(previous))
    fresher = CareerDetails(work_status="FRESHER", company_name="Stale value")
    assert fresher.company_name == ""
    assert fresher.notice_period == "IMMEDIATE"
    assert "company_name" not in missing_required(fresher)


def test_currency_defaults_and_validation():
    assert CareerDetails(annual_salary=123456).annual_salary_currency == "INR"
    with pytest.raises(ValidationError):
        CareerDetails(annual_salary_currency="EUR")
    fields = {field["key"]: field for field in form_fields()}
    assert fields["notice_period"]["required"]
    assert fields["annual_salary"]["label"] == "Annual Salary"
    assert fields["annual_salary_currency"]["options"][1]["value"] == "USD"
