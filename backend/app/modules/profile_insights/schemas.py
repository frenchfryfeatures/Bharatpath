from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.core.schemas import ApiSchema

from .domain import RULE_KEYS


class StrengthRule(ApiSchema):
    key: str
    label: str = Field(min_length=1, max_length=100)
    benefit: str = Field(min_length=1, max_length=300)
    weight: int = Field(ge=1, le=100)
    enabled: bool = True
    order: int = Field(ge=0, le=100)

    @field_validator("label", "benefit", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class ConfigRequest(ApiSchema):
    version: int = Field(ge=0)
    metrics: dict[str, bool]
    rollout_percent: int = Field(ge=0, le=100)
    rules: list[StrengthRule] = Field(max_length=30)

    @model_validator(mode="after")
    def valid_rules(self):
        if set(self.metrics) != {"views", "search", "actions", "applications", "strength"}:
            raise ValueError("Unknown metric switches")
        keys = [rule.key for rule in self.rules]
        if len(keys) != len(set(keys)) or set(keys) - set(RULE_KEYS):
            raise ValueError("Use unique supported profile fields")
        if self.metrics["strength"] and not any(rule.enabled for rule in self.rules):
            raise ValueError("Enable at least one strength rule or disable the metric")
        return self


class ImpressionRequest(ApiSchema):
    receipts: list[UUID] = Field(min_length=1, max_length=100)


class RecruiterAction(ApiSchema):
    candidate_id: UUID
    action: Literal["CV_DOWNLOAD", "EMAIL_OPENED", "CALL_OPENED"]
    event_id: UUID
    application_id: UUID | None = None
