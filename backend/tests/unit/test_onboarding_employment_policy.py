from app.modules.candidate.career import CareerDetails, employment_dates_ordered, missing_required


def test_strict_employment_ordering_on_save():
    for end, expected in [("2020-01", False), ("2020-02", False), ("2020-03", True)]:
        # model_copy represents a loaded historical profile too.
        details = CareerDetails().model_copy(update={"employment_start": "2020-02", "employment_end": end})
        assert employment_dates_ordered(details) is expected


def test_salary_required_for_experienced_only_and_zero_is_an_explicit_value():
    assert "annual_salary" not in missing_required(CareerDetails(work_status="FRESHER"))
    for employed in ["YES", "NO"]:
        details = CareerDetails(work_status="EXPERIENCED", currently_employed=employed)
        assert "annual_salary" in missing_required(details)
        details.annual_salary = 0
        assert "annual_salary" not in missing_required(details)
