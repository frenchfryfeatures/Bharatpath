"""No estimated activity: comparisons, supported fields and exact completeness weights."""

import pytest
from pydantic import ValidationError

from app.modules.profile_insights.domain import comparison, default_config, strength
from app.modules.profile_insights.schemas import ConfigRequest


def test_comparison_never_invents_a_percentage_from_zero():
    assert comparison(5, 0) == {"current": 5, "previous": 0, "change": 5, "percent_change": None}
    assert comparison(0, 0)["percent_change"] is None
    assert comparison(15, 10)["percent_change"] == 50
    assert comparison(0, 10)["percent_change"] == -100


def test_strength_uses_only_real_applicable_profile_fields_and_admin_rules():
    rules = default_config()["rules"]
    assert strength({}, rules)["score"] == 0
    full = {rule["key"]: True for rule in rules}
    full["work_status"] = "EXPERIENCED"
    assert strength(full, rules)["score"] == 100
    fresher = {**full, "work_status": "FRESHER", "company_name": ""}
    assert strength(fresher, rules)["score"] == 100
    modified = [
        {**rule, "enabled": rule["key"] == "headline", "weight": 20, "benefit": "Custom benefit"}
        for rule in rules
    ]
    assert strength({}, modified)["next_steps"][0]["benefit"] == "Custom benefit"
    assert strength({"headline": "Engineer"}, modified)["score"] == 100


def test_config_rejects_unknown_or_duplicate_fields_and_empty_strength():
    config = {**default_config(), "version": 0}
    ConfigRequest(**config)
    for rules in ([{**config["rules"][0], "key": "unsupported"}], [config["rules"][0]] * 2, []):
        with pytest.raises(ValidationError):
            ConfigRequest(**{**config, "rules": rules})


def test_legacy_placeholder_skills_do_not_inflate_strength():
    rules = [rule for rule in default_config()["rules"] if rule["key"] == "key_skills"]
    assert strength({"key_skills": ["General"]}, rules)["score"] == 0
    assert strength({"key_skills": ["SAP"]}, rules)["score"] == 100
