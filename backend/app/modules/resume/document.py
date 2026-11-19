"""Lossless document writes use the same schema and scoring projection as the builder."""

import json
from typing import Any

from app.core.errors import ValidationError
from app.modules.resume.structuring import SCHEMA_VERSION, StructuredResume
from app.modules.resume_builder import domain


def document_payload(document: StructuredResume) -> dict[str, Any]:
    data = document.model_dump(mode="json")
    if len(json.dumps(data, ensure_ascii=False)) > domain.MAX_CONTENT_CHARS:
        raise ValidationError(
            code="resume_builder_draft_too_long", title="Please shorten your resume."
        )
    invalid = domain.personal_detail_fields(data) + domain.malformed_date_fields(data)
    if invalid:
        raise ValidationError(
            code="resume_document_invalid",
            title="Please check the highlighted resume fields.",
            params={"fields": invalid},
        )
    from app.modules.scoring.domain import render_structured_resume

    fields = domain.scoring_fields(data)
    return {
        **fields,
        "raw_text": render_structured_resume(fields),
        "structured_resume": {
            "status": "READY",
            "reason": "typed_by_candidate",
            "data": data,
            "model_id": None,
            "prompt_version": None,
            "schema_version": SCHEMA_VERSION,
        },
    }
