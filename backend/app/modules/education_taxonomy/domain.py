"""Pure education taxonomy rules, sharing catalogue name normalization."""

from app.modules.taxonomy.domain import clean_name as clean_name
from app.modules.taxonomy.domain import normalize as normalize
from app.modules.taxonomy.domain import slug_for as slug_for

LEVELS = ("qualification", "course", "specialization")
PROFILE_KEYS = {
    "qualification": "highest_qualification",
    "course": "course",
    "specialization": "specialization",
}
PARENTS = {"course": "qualification", "specialization": "course"}
NA_NAME = "General / Not applicable"
QUALIFICATION_ORDER = (
    "Doctorate / PhD",
    "Post Graduation (Masters)",
    "Graduation (Bachelors)",
    "Diploma / Polytechnic",
    "ITI / Vocational",
    "Professional Qualification",
    "12th Pass",
    "10th Pass",
    "Below 10th",
)


def missing_custom_fields(details: object) -> list[str]:
    """Every descendant of an Others choice needs text when completing the form."""
    others = getattr(details, "education_others", {})
    custom = False
    missing = []
    for key in PROFILE_KEYS.values():
        custom = custom or key in others
        if custom and not str(getattr(details, key, "") or "").strip():
            missing.append(key)
    return missing
