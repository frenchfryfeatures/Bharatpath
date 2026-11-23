"""Pure insights rules: real counters, IST calendar days and profile completeness."""

from datetime import timedelta, timezone
from typing import Any

IST = timezone(timedelta(hours=5, minutes=30))
METRICS = (
    "PROFILE_VIEW",
    "SEARCH_APPEARANCE",
    "CV_DOWNLOAD",
    "SAVED",
    "SHORTLISTED",
    "INVITED",
    "MESSAGE_SENT",
    "EMAIL_OPENED",
    "CALL_OPENED",
    "APPLICATION_VIEW",
)
ACTIONS = (
    "CV_DOWNLOAD",
    "SAVED",
    "SHORTLISTED",
    "INVITED",
    "MESSAGE_SENT",
    "EMAIL_OPENED",
    "CALL_OPENED",
)
METRIC_FLAGS = {
    "PROFILE_VIEW": "views",
    "SEARCH_APPEARANCE": "search",
    "APPLICATION_VIEW": "applications",
    **dict.fromkeys(ACTIONS, "actions"),
}
RULES = [
    ("full_name", "Add your name", "Help recruiters identify your profile.", 10),
    ("current_city", "Add your current city", "Help recruiters understand your location.", 10),
    ("headline", "Add a profile headline", "Summarise your strengths for recruiters.", 10),
    ("key_skills", "Add your skills", "Describe the work you can do.", 15),
    ("highest_qualification", "Add your highest qualification", "Make your education clear.", 10),
    ("institution", "Add your institute", "Give context to your education.", 5),
    ("work_status", "Add your work status", "Help recruiters understand your experience.", 10),
    (
        "company_name",
        "Add your employment details",
        "Describe your current or previous employer.",
        10,
    ),
    ("resume", "Create or upload your resume", "Give recruiters a document they can review.", 15),
    ("photo", "Add a profile photo", "Help recruiters recognise your profile.", 5),
]
RULE_KEYS = tuple(row[0] for row in RULES)
#: Rules for things the profile form does not require (2026-11-23). They
#: stay as suggestions in `next_steps` but never count toward the score, so a
#: candidate who filled every required field reaches 100% -- before, an
#: unwritten headline or a missing photo held a complete profile at 85%.
OPTIONAL_RULE_KEYS = frozenset({"headline", "photo"})


def default_config() -> dict[str, Any]:
    return {
        "metrics": dict.fromkeys(("views", "search", "actions", "applications", "strength"), True),
        "rollout_percent": 100,
        "rules": [
            {
                "key": key,
                "label": label,
                "benefit": benefit,
                "weight": weight,
                "enabled": True,
                "order": index,
            }
            for index, (key, label, benefit, weight) in enumerate(RULES)
        ],
    }


def comparison(current: int, previous: int) -> dict[str, Any]:
    return {
        "current": current,
        "previous": previous,
        "change": current - previous,
        "percent_change": round((current - previous) * 100 / previous, 1) if previous else None,
    }


def strength(facts: dict[str, Any], rules: list[dict[str, Any]]) -> dict[str, Any]:
    applicable = [
        rule
        for rule in rules
        if rule["enabled"]
        and not (rule["key"] == "company_name" and facts.get("work_status") == "FRESHER")
    ]

    def present(value: Any) -> bool:
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, list):
            return any(str(item).strip() for item in value)
        return value is not None and value is not False

    facts = dict(facts)
    if isinstance(facts.get("key_skills"), list):
        facts["key_skills"] = [
            skill
            for skill in facts["key_skills"]
            if str(skill).strip().casefold() not in {"general", "fresher"}
        ]

    # If staff enabled only optional rules, those are what they asked to
    # measure, so they count.
    counted = [rule for rule in applicable if rule["key"] not in OPTIONAL_RULE_KEYS] or applicable
    total = sum(rule["weight"] for rule in counted)
    earned = sum(rule["weight"] for rule in counted if present(facts.get(rule["key"])))
    # Required steps first, then optional suggestions, each in form order.
    missing = sorted(
        [rule for rule in applicable if not present(facts.get(rule["key"]))],
        key=lambda rule: (rule["key"] in OPTIONAL_RULE_KEYS, rule["order"], -rule["weight"]),
    )
    return {
        "score": round(100 * earned / total) if total else 0,
        "earned_weight": earned,
        "total_weight": total,
        "next_steps": [
            {
                "key": rule["key"],
                "label": rule["label"],
                "benefit": rule["benefit"],
                "optional": rule["key"] in OPTIONAL_RULE_KEYS,
            }
            for rule in missing
        ],
    }
