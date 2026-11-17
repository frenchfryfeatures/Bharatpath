from pathlib import Path
import pytest
from pydantic import ValidationError
from app.modules.education_taxonomy.domain import normalize
from app.modules.education_taxonomy.schemas import OptionWrite, Links
from app.modules.education_taxonomy.seed import counts, load_csv


def test_csv_counts_and_shared_specializations():
    rows = load_csv(Path(__file__).parents[2] / "data/education_taxonomy.csv")
    assert counts(rows) == {
        "qualifications": 9,
        "courses": 123,
        "unique_specializations": 414,
        "course_specialization_links": 1099,
    }
    assert counts(rows + rows) == counts(rows)
    assert sum(s == "General / Not applicable" for q, c, s in rows) > 1


def test_duplicate_normalization():
    assert normalize("  Computer   Science  ") == normalize("COMPUTER SCIENCE")
    assert OptionWrite(name="  Accounting  ").name == "Accounting"


@pytest.mark.parametrize(
    "data",
    [
        {"name": ""},
        {"name": "x", "level_rank": 0},
        {"name": "x", "level_rank": 10},
        {"name": "<script>"},
        {"name": "x", "parent_id": "bad"},
    ],
)
def test_write_validation(data):
    with pytest.raises(ValidationError):
        OptionWrite.model_validate(data)


def test_link_validation():
    with pytest.raises(ValidationError):
        Links(course_ids=[], specialization_ids=[], action="attach", revision=1)


def test_custom_descendants_required_on_completion():
    from types import SimpleNamespace
    from app.modules.education_taxonomy.domain import missing_custom_fields

    assert missing_custom_fields(
        SimpleNamespace(
            highest_qualification="New",
            course="Custom course",
            specialization="",
            education_others={"highest_qualification": "New"},
        )
    ) == ["specialization"]
    assert not missing_custom_fields(
        SimpleNamespace(
            highest_qualification="Known",
            course="Known course",
            specialization="",
            education_others={},
        )
    )
