"""Generate both client contracts from the backend resume document schema."""

import json
from pathlib import Path

from app.modules.resume import structuring as model

root = Path(__file__).resolve().parents[2]
entries = {
    key: cls().model_dump(mode="json")
    for key, cls in {
        "others": model.ContactLink,
        "experience": model.ResumeExperience,
        "education": model.ResumeEducation,
        "projects": model.ResumeProject,
        "certifications": model.ResumeCertification,
        "languages": model.ResumeLanguage,
        "other_sections": model.ResumeOtherSection,
    }.items()
}
contract = {
    "document": model.StructuredResume().model_dump(mode="json"),
    "entries": entries,
    "schema": model.StructuredResume.model_json_schema(),
}
for relative in (
    "frontend/lib/resume/editor-contract.json",
    "mobile-app/services/profile/resume-editor-contract.json",
):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(relative)
