from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.taxonomy.domain import clean_name, normalize
from app.modules.taxonomy.schemas import OptionWrite, Reorder
from app.modules.taxonomy.seed import counts, load_source
from app.modules.taxonomy.tabular import read_sheets, write_table


def test_supplied_seed_has_verified_counts_and_independent_department_priorities():
    data = load_source(Path(__file__).parents[2] / "data/job_taxonomy.json")
    assert counts(data) == (31, 29, 110, 507)
    codes = {department["code"] for department in data["departments"]}
    assert all(set(industry["priorities"]) <= codes for industry in data["industries"])
    assert len({normalize(department["name"]) for department in data["departments"]}) == 29


def test_duplicate_key_ignores_case_whitespace_and_unicode_width():
    assert normalize("  SOFTWARE   Engineering ") == normalize("Software Engineering")
    assert normalize("\uff33\uff41\uff4c\uff45\uff53") == normalize("Sales")
    assert OptionWrite(name="  Data    Science ").name == "Data Science"


@pytest.mark.parametrize("value", ["", "  ", "x" * 161, "<script>alert(1)</script>", "a\u202eb"])
def test_names_reject_blank_overlong_markup_and_control_characters(value):
    with pytest.raises(ValueError):
        clean_name(value)


def test_api_payload_validation():
    for payload in (
        {"name": "A", "type": "Unknown"},
        {"name": "A", "parent_id": "not-an-id"},
        {"name": "A", "sort_order": -1},
    ):
        with pytest.raises(ValidationError):
            OptionWrite.model_validate(payload)
    with pytest.raises(ValidationError):
        Reorder(ids=[], versions={})


@pytest.mark.parametrize("format", ["csv", "xlsx"])
def test_tabular_round_trip_preserves_unicode_names_and_ids(format):
    rows = [["id", "name"], ["abc", "Research & Development"], ["def", "विक्रय"]]
    assert next(iter(read_sheets(write_table(rows, format), f"test.{format}").values())) == rows


def test_csv_export_does_not_execute_formulas():
    rows = read_sheets(write_table([["name"], ["=1+1"]], "csv"), "test.csv")["Options"]
    assert rows[1][0] == "'=1+1"


def test_import_rejects_large_files():
    with pytest.raises(ValueError):
        read_sheets(b"x" * 2_000_001, "test.xlsx")
